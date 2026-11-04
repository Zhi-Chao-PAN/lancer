import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startIsolatedDisplay } from "../helpers/isolated-display";

test("isolated display waits for the server and WM and cleans up both owned processes", async () => {
  test.skip(process.platform === "win32", "POSIX X11 helpers");
  const root = await mkdtemp(join(tmpdir(), "electron-display-contract-"));
  const scripts = {
    Xvfb: '#!/bin/sh\necho $$ > "$TEST_SERVER_PID"\nprintf "%s\\n" "$@" > "$TEST_SERVER_ARGS"\necho 777 >&3\nexec sleep 30\n',
    openbox:
      '#!/bin/sh\necho $$ > "$TEST_WM_PID"\nprintf "%s" "$DISPLAY" > "$TEST_DISPLAY"\nprintf "%s\\n" "$@" > "$TEST_WM_ARGS"\n[ -z "${XAUTHORITY:-}" ] || exit 91\nprintf "Openbox diagnostic before readiness\\n\\npi-app-wm-ready\\n"\nexec sleep 30\n',
  };
  for (const [name, source] of Object.entries(scripts)) {
    await writeFile(join(root, name), source);
    await chmod(join(root, name), 0o755);
  }
  const display = await startIsolatedDisplay({
    PATH: root + ":" + process.env.PATH,
    DISPLAY: ":outer",
    XAUTHORITY: "outer-cookie",
    TEST_SERVER_PID: join(root, "server.pid"),
    TEST_SERVER_ARGS: join(root, "args"),
    TEST_WM_PID: join(root, "wm.pid"),
    TEST_WM_ARGS: join(root, "wm.args"),
    TEST_DISPLAY: join(root, "display"),
  });
  try {
    expect(display.env.DISPLAY).toBe(":777");
    expect(display.env.XAUTHORITY).toBeUndefined();
    expect(await readFile(join(root, "display"), "utf8")).toBe(":777");
    expect((await readFile(join(root, "wm.args"), "utf8")).trimEnd().split("\n")).toEqual([
      "--sm-disable",
      "--startup",
      "printf 'pi-app-wm-ready\\n'",
    ]);
    expect((await readFile(join(root, "args"), "utf8")).trimEnd().split("\n")).toEqual([
      "-displayfd",
      "3",
      "-screen",
      "0",
      "1920x1080x24",
      "-nolisten",
      "tcp",
      "-ac",
    ]);
  } finally {
    await display.close();
  }
  await display.close();
  for (const name of ["server", "wm"]) {
    const pid = Number((await readFile(join(root, name + ".pid"), "utf8")).trim());
    expect(() => process.kill(pid, 0)).toThrow();
  }
});
