import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

test("isolated display wrapper preserves Electron flags, exit status and owned WM cleanup", async () => {
  test.skip(process.platform === "win32", "POSIX display wrapper");
  const root = await mkdtemp(join(tmpdir(), "electron-display-contract-"));
  const scripts = {
    "xvfb-run":
      '#!/bin/sh\n[ "$1" = "--auto-servernum" ] || exit 90\n[ "$2" = "--server-args=-screen 0 1920x1080x24" ] || exit 91\nshift 2\nexport DISPLAY=:fixture-isolated\nexec "$@"\n',
    openbox: '#!/bin/sh\necho $$ > "$TEST_WM_PID"\nexec sleep 30\n',
    electron:
      '#!/bin/sh\nwhile [ ! -s "$TEST_WM_PID" ]; do sleep 0.01; done\nprintf "%s\\n" "$@" > "$TEST_ELECTRON_ARGS"\nprintf "%s" "$DISPLAY" > "$TEST_DISPLAY"\nexit 7\n',
  };
  for (const [name, source] of Object.entries(scripts)) {
    await writeFile(join(root, name), source);
    await chmod(join(root, name), 0o755);
  }
  const args = ["--inspect=0", "--remote-debugging-port=0", "app with spaces"];
  const result = spawnSync(
    resolve("apps/desktop/tests/helpers/electron-isolated-display.sh"),
    args,
    {
      env: {
        ...process.env,
        PATH: root + ":" + process.env.PATH,
        DISPLAY: ":outer",
        PI_APP_TEST_ELECTRON_BINARY: join(root, "electron"),
        TEST_WM_PID: join(root, "wm.pid"),
        TEST_ELECTRON_ARGS: join(root, "args"),
        TEST_DISPLAY: join(root, "display"),
      },
      encoding: "utf8",
      timeout: 5_000,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(7);
  expect((await readFile(join(root, "args"), "utf8")).trimEnd().split("\n")).toEqual(args);
  expect(await readFile(join(root, "display"), "utf8")).toBe(":fixture-isolated");
  const pid = Number((await readFile(join(root, "wm.pid"), "utf8")).trim());
  expect(() => process.kill(pid, 0)).toThrow();
});
