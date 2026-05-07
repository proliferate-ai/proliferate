#!/usr/bin/env python3

from __future__ import annotations

from pathlib import Path
import sys

MAX_LINES = 600
REPO_ROOT = Path(__file__).resolve().parents[1]
ALLOWLIST_PATH = REPO_ROOT / "scripts" / "max_lines_allowlist.txt"
CHECK_ROOTS = [
    "anyharness/crates",
    "anyharness/sdk/src",
    "anyharness/sdk-react/src",
    "desktop/src",
    "desktop/src-tauri/src",
    "desktop/src-tauri/build.rs",
    "server/proliferate",
    "server/tests",
]
EXTENSIONS = {".py", ".rs", ".ts", ".tsx"}
EXCLUDED_PATH_PREFIXES = {
    "anyharness/sdk/src/generated/",
    "desktop/src/lib/access/cloud/generated/",
}


def load_allowlist() -> set[str]:
    entries: set[str] = set()
    for raw_line in ALLOWLIST_PATH.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        entries.add(line)
    return entries


def should_skip(relative_path: str) -> bool:
    return any(relative_path.startswith(prefix) for prefix in EXCLUDED_PATH_PREFIXES)


def count_lines(path: Path) -> int:
    data = path.read_bytes()
    if not data:
        return 0
    return data.count(b"\n") + (0 if data.endswith(b"\n") else 1)


def iter_source_files() -> list[tuple[str, int]]:
    files: list[tuple[str, int]] = []
    for root_entry in CHECK_ROOTS:
        root_path = REPO_ROOT / root_entry
        if root_path.is_file():
            relative = root_path.relative_to(REPO_ROOT).as_posix()
            if root_path.suffix in EXTENSIONS and not should_skip(relative):
                files.append((relative, count_lines(root_path)))
            continue
        if not root_path.is_dir():
            continue
        for path in sorted(root_path.rglob("*")):
            if not path.is_file() or path.suffix not in EXTENSIONS:
                continue
            relative = path.relative_to(REPO_ROOT).as_posix()
            if should_skip(relative):
                continue
            files.append((relative, count_lines(path)))
    return files


def main() -> int:
    allowlist = load_allowlist()
    violations: list[tuple[str, int]] = []
    stale_allowlist: list[str] = []

    for relative_path, line_count in iter_source_files():
        if line_count <= MAX_LINES:
            if relative_path in allowlist:
                stale_allowlist.append(relative_path)
            continue
        if relative_path in allowlist:
            continue
        violations.append((relative_path, line_count))

    stale_allowlist.extend(sorted(path for path in allowlist if not (REPO_ROOT / path).exists()))

    if not violations and not stale_allowlist:
        print(f"Max-lines check passed ({MAX_LINES} lines).")
        return 0

    if violations:
        print(f"Files above {MAX_LINES} lines that are not allowlisted:")
        for relative_path, line_count in violations:
            print(f"  {relative_path}: {line_count}")

    if stale_allowlist:
        if violations:
            print()
        print("Stale allowlist entries (remove these from scripts/max_lines_allowlist.txt):")
        for relative_path in sorted(stale_allowlist):
            print(f"  {relative_path}")

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
