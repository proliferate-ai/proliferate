#!/usr/bin/env python3

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

MAX_LINES = 600
COMPONENT_MAX_LINES = 500
SERVER_API_MAX_LINES = 400
SERVER_SERVICE_MAX_LINES = 800
SERVER_MODELS_MAX_LINES = 500
SERVER_DOMAIN_MAX_LINES = 500
SERVER_STORE_MAX_LINES = 700
SERVER_DB_MODELS_MAX_LINES = 500
REPO_ROOT = Path(__file__).resolve().parents[1]
ALLOWLIST_PATH = REPO_ROOT / "scripts" / "max_lines_allowlist.txt"
CHECK_ROOTS = [
    "anyharness/crates",
    "anyharness/sdk/src",
    "anyharness/sdk-react/src",
    "cloud/sdk/src",
    "cloud/sdk-react/src",
    "apps/desktop/src",
    "apps/desktop/src-tauri/src",
    "apps/desktop/src-tauri/build.rs",
    "server/proliferate",
    "server/tests",
]
EXTENSIONS = {".py", ".rs", ".ts", ".tsx"}
EXCLUDED_PATH_PREFIXES = {
    "anyharness/sdk/src/generated/",
    "cloud/sdk/src/generated/",
}


@dataclass(frozen=True)
class AllowlistEntry:
    path: str
    max_lines: int
    reason: str


def load_allowlist() -> dict[str, AllowlistEntry]:
    entries: dict[str, AllowlistEntry] = {}
    for line_number, raw_line in enumerate(ALLOWLIST_PATH.read_text().splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split(maxsplit=2)
        if len(parts) != 3:
            raise ValueError(
                f"{ALLOWLIST_PATH.relative_to(REPO_ROOT)}:{line_number}: "
                "expected path max_lines reason"
            )
        entry_path, raw_max_lines, reason = parts
        try:
            max_lines = int(raw_max_lines)
        except ValueError as exc:
            raise ValueError(
                f"{ALLOWLIST_PATH.relative_to(REPO_ROOT)}:{line_number}: "
                "max_lines must be an integer"
            ) from exc
        if max_lines < 1:
            raise ValueError(
                f"{ALLOWLIST_PATH.relative_to(REPO_ROOT)}:{line_number}: "
                "max_lines must be positive"
            )
        if entry_path in entries:
            raise ValueError(
                f"{ALLOWLIST_PATH.relative_to(REPO_ROOT)}:{line_number}: "
                "duplicate allowlist entry"
            )
        entries[entry_path] = AllowlistEntry(
            path=entry_path,
            max_lines=max_lines,
            reason=reason,
        )
    return entries


def should_skip(relative_path: str) -> bool:
    return any(relative_path.startswith(prefix) for prefix in EXCLUDED_PATH_PREFIXES)


def count_lines(path: Path) -> int:
    data = path.read_bytes()
    if not data:
        return 0
    return data.count(b"\n") + (0 if data.endswith(b"\n") else 1)


def server_max_lines_for(relative_path: str) -> Optional[int]:
    path = Path(relative_path)
    parts = path.parts
    name = path.name

    if relative_path.startswith("server/proliferate/server/"):
        if name == "api.py":
            return SERVER_API_MAX_LINES
        if name == "service.py":
            return SERVER_SERVICE_MAX_LINES
        if name == "models.py":
            return SERVER_MODELS_MAX_LINES
        if "domain" in parts:
            return SERVER_DOMAIN_MAX_LINES
        return None

    if relative_path.startswith("server/proliferate/db/store/"):
        return SERVER_STORE_MAX_LINES

    if relative_path.startswith("server/proliferate/db/models/"):
        return SERVER_DB_MODELS_MAX_LINES

    return None


def max_lines_for(relative_path: str) -> int:
    server_max_lines = server_max_lines_for(relative_path)
    if server_max_lines is not None:
        return server_max_lines
    if (
        relative_path.startswith("apps/desktop/src/components/")
        and relative_path.endswith(".tsx")
    ):
        return COMPONENT_MAX_LINES
    return MAX_LINES


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
    violations: list[str] = []
    stale_allowlist: list[str] = []
    seen_paths: set[str] = set()

    for relative_path, line_count in iter_source_files():
        seen_paths.add(relative_path)
        max_lines = max_lines_for(relative_path)
        entry = allowlist.get(relative_path)

        if line_count <= max_lines:
            if entry is not None:
                stale_allowlist.append(
                    f"{relative_path} allowlisted={entry.max_lines} "
                    f"observed={line_count} max={max_lines}"
                )
            continue

        if entry is not None:
            if line_count > entry.max_lines:
                violations.append(
                    f"{relative_path}: {line_count} "
                    f"(max {max_lines}, allowlisted {entry.max_lines})"
                )
            elif line_count < entry.max_lines:
                stale_allowlist.append(
                    f"{relative_path} allowlisted={entry.max_lines} "
                    f"observed={line_count} max={max_lines}"
                )
            continue

        violations.append(f"{relative_path}: {line_count} (max {max_lines})")

    stale_allowlist.extend(
        sorted(
            f"{path} allowlisted={entry.max_lines} observed=missing-file"
            for path, entry in allowlist.items()
            if path not in seen_paths and not (REPO_ROOT / path).exists()
        )
    )

    if not violations and not stale_allowlist:
        print(
            "Max-lines check passed "
            f"(repo max {MAX_LINES}, component max {COMPONENT_MAX_LINES}, "
            "server layer maxes enabled)."
        )
        return 0

    if violations:
        print(
            "Files above their max line threshold that are not allowlisted "
            "or exceed their allowlisted count:"
        )
        for violation in violations:
            print(f"  {violation}")

    if stale_allowlist:
        if violations:
            print()
        print("Stale max-lines allowlist entries:")
        for entry in sorted(stale_allowlist):
            print(f"  {entry}")

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
