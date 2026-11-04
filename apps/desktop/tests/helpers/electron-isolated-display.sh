#!/bin/sh
set -eu
: "${PI_APP_TEST_ELECTRON_BINARY:?Missing test Electron executable}"

# Each CI Electron process owns its X11 focus, pointer, clipboard and WM. The
# outer workflow display remains available to non-interactive helper processes.
exec xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" sh -c '
  set -u
  openbox >/dev/null 2>&1 &
  wm_pid=$!
  electron_pid=
  cleanup() {
    trap - EXIT HUP INT TERM
    if [ -n "$electron_pid" ]; then kill "$electron_pid" 2>/dev/null || :; fi
    kill "$wm_pid" 2>/dev/null || :
    wait "$wm_pid" 2>/dev/null || :
  }
  trap cleanup EXIT
  trap "exit 129" HUP
  trap "exit 130" INT
  trap "exit 143" TERM
  "$@" &
  electron_pid=$!
  wait "$electron_pid"
  result=$?
  electron_pid=
  exit "$result"
' sh "$PI_APP_TEST_ELECTRON_BINARY" "$@"
