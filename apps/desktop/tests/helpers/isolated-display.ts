import { spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";

function outputLine(
  child: ChildProcess,
  stream: Readable,
  accepts: (line: string) => boolean = () => true,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const finish = (error?: Error, line?: string) => {
      clearTimeout(timer);
      stream.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolve(line ?? "");
    };
    const onError = (error: Error) => finish(error);
    const onExit = (code: number | null) =>
      finish(new Error(`Display helper exited before readiness (${code})`));
    const onData = (data: Buffer) => {
      output += data.toString();
      while (output.includes("\n")) {
        const boundary = output.indexOf("\n");
        const line = output.slice(0, boundary).trim();
        output = output.slice(boundary + 1);
        if (accepts(line)) {
          finish(undefined, line);
          return;
        }
      }
    };
    const timer = setTimeout(() => finish(new Error("Display helper did not become ready")), 5_000);
    stream.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function stop(child: ChildProcess | undefined): Promise<void> {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

export async function startIsolatedDisplay(env: Record<string, string>) {
  // Keep Electron itself as Playwright's launched process. Xvfb and its WM are
  // sidecars with explicit readiness and teardown, not an executable wrapper.
  const server = spawn(
    "Xvfb",
    ["-displayfd", "3", "-screen", "0", "1920x1080x24", "-nolisten", "tcp", "-ac"],
    { env, stdio: ["ignore", "ignore", "ignore", "pipe"] },
  );
  let windowManager: ChildProcess | undefined;
  const cleanupOnExit = () => {
    windowManager?.kill("SIGKILL");
    server.kill("SIGKILL");
  };
  process.once("exit", cleanupOnExit);
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      try {
        await stop(windowManager);
        await stop(server);
      } finally {
        process.off("exit", cleanupOnExit);
      }
    })());
  try {
    const displayNumber = await outputLine(server, server.stdio[3] as Readable);
    if (!/^\d+$/.test(displayNumber)) throw new Error("Invalid Xvfb display number");
    const displayEnv: Record<string, string> = { ...env, DISPLAY: `:${displayNumber}` };
    // This private CI X server accepts local clients only. Do not forward the
    // outer xvfb-run authority cookie to an unrelated server.
    delete displayEnv.XAUTHORITY;
    windowManager = spawn("openbox", ["--sm-disable", "--startup", "printf 'pi-app-wm-ready\\n'"], {
      env: displayEnv,
      stdio: ["ignore", "pipe", "ignore"],
    });
    // Openbox also writes ordinary informational messages to stdout.
    await outputLine(windowManager, windowManager.stdout!, (line) => line === "pi-app-wm-ready");
    return { env: displayEnv, close };
  } catch (error) {
    await close();
    throw error;
  }
}
