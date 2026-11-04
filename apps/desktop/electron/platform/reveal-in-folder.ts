import { spawn } from "node:child_process";
import path from "node:path";
import { shell } from "electron";

/**
 * Show a file in the system file manager.
 *
 * On Linux, Electron's `shell.showItemInFolder` runs `xdg-open` through
 * Chromium's process launcher, which inherits this process's stdout and
 * DevTools sockets. The file manager daemonizes with those descriptors, so
 * after quit a parent waiting on process close — Playwright included — never
 * observes it. Electron's own `child_process.spawn` also leaves non-stdio
 * descriptors open, so the replacement drops every fd above stderr first.
 */
export function revealInFolder(filePath: string): void {
  if (process.platform !== "linux") {
    shell.showItemInFolder(filePath);
    return;
  }

  const directory = path.dirname(filePath);
  const child = spawn(
    "/bin/sh",
    [
      "-c",
      [
        'cd "$1" || exit 1',
        "fds=$(ls /proc/self/fd)",
        "for n in $fds; do",
        '  if [ "$n" -gt 2 ]; then',
        '    eval "exec $n>&-" 2>/dev/null || true',
        "  fi",
        "done",
        "exec xdg-open .",
      ].join("\n"),
      "sh",
      directory,
    ],
    { detached: true, stdio: "ignore" },
  );
  child.on("error", () => {
    // A missing file manager should not fail the export that already finished.
  });
  child.unref();
}
