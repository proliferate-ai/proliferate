#!/usr/bin/env python3
"""Run a command with a wall-clock timeout and terminate its process group."""

from __future__ import annotations

import os
import signal
import subprocess
import sys


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: run-with-timeout.py <seconds> <command> [args...]", file=sys.stderr)
        return 2

    timeout_seconds = float(sys.argv[1])
    process = subprocess.Popen(sys.argv[2:], start_new_session=True)
    try:
        return process.wait(timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        print(
            f"command timed out after {timeout_seconds:g}s: {sys.argv[2]}",
            file=sys.stderr,
        )
        return 124


if __name__ == "__main__":
    raise SystemExit(main())
