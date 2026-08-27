#!/usr/bin/env python3
"""Enforce the file-size caps recorded as SRV-SIZE-1 and PROD-SIZE-1.

Measured size debt is a ratchet, not an exception ledger: each owner's
``lints/<owner>/ratchets.toml`` records the observed count allowed per file, and
that count may only shrink. Growth fails, an unlisted file over its threshold
fails, and a stale entry (file now under its allowance, or gone) fails too.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts import lint_records  # noqa: E402 - repo-root bootstrap above

SERVER_SIZE_RULE_ID = "SRV-SIZE-1"
REPO_SIZE_RULE_ID = "PROD-SIZE-1"

MAX_LINES = 600
COMPONENT_MAX_LINES = 500
SERVER_API_MAX_LINES = 400
SERVER_SERVICE_MAX_LINES = 800
SERVER_MODELS_MAX_LINES = 500
SERVER_DOMAIN_MAX_LINES = 500
SERVER_STORE_MAX_LINES = 700
SERVER_DB_MODELS_MAX_LINES = 500
CHECK_ROOTS = [
    "anyharness/crates",
    "anyharness/sdk/src",
    "anyharness/sdk-react/src",
    "cloud/sdk/src",
    "cloud/sdk-react/src",
    "apps/desktop/src",
    "apps/packages/product-client/src",
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
class RatchetEntry:
    path: str
    max_lines: int
    reason: str
    owner: str


def load_ratchet() -> dict[str, RatchetEntry]:
    """The merged [[max_lines]] baseline from every owner's ratchets.toml."""
    entries: dict[str, RatchetEntry] = {}
    for owner in lint_records.OWNERS:
        source = f"lints/{owner}/ratchets.toml"
        for raw in lint_records.load_ratchets(owner).get("max_lines", []):
            missing = [key for key in ("path", "max_lines", "reason") if key not in raw]
            if missing:
                raise ValueError(f"{source}: entry missing fields: {', '.join(missing)} ({raw})")
            entry_path = raw["path"]
            max_lines = raw["max_lines"]
            if not isinstance(max_lines, int) or max_lines < 1:
                raise ValueError(f"{source}: {entry_path}: max_lines must be a positive integer")
            if entry_path in entries:
                raise ValueError(
                    f"{source}: {entry_path} is already recorded in "
                    f"lints/{entries[entry_path].owner}/ratchets.toml"
                )
            entries[entry_path] = RatchetEntry(
                path=entry_path,
                max_lines=max_lines,
                reason=raw["reason"],
                owner=owner,
            )
    return entries


def size_rule(relative_path: str) -> lint_records.Rule:
    """The record whose threshold governs this file."""
    rule_id = (
        SERVER_SIZE_RULE_ID
        if server_max_lines_for(relative_path) is not None
        else REPO_SIZE_RULE_ID
    )
    return _ruleset().rule(rule_id)


_RULESET: lint_records.RuleSet | None = None


def _ruleset() -> lint_records.RuleSet:
    global _RULESET
    if _RULESET is None:
        _RULESET = lint_records.load()
    return _RULESET


def should_skip(relative_path: str) -> bool:
    return any(relative_path.startswith(prefix) for prefix in EXCLUDED_PATH_PREFIXES)


def count_lines(path: Path) -> int:
    data = path.read_bytes()
    if not data:
        return 0
    return data.count(b"\n") + (0 if data.endswith(b"\n") else 1)


def server_max_lines_for(relative_path: str) -> int | None:
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
    if relative_path.startswith("apps/desktop/src/components/") and relative_path.endswith(".tsx"):
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
    ratchet = load_ratchet()
    diagnostics: list[str] = []
    stale: list[str] = []
    seen_paths: set[str] = set()

    for relative_path, line_count in iter_source_files():
        seen_paths.add(relative_path)
        max_lines = max_lines_for(relative_path)
        entry = ratchet.get(relative_path)

        if line_count <= max_lines:
            if entry is not None:
                stale.append(
                    f"{relative_path} ratchet={entry.max_lines} "
                    f"observed={line_count} max={max_lines} "
                    f"(lints/{entry.owner}/ratchets.toml)"
                )
            continue

        if entry is not None:
            if line_count > entry.max_lines:
                diagnostics.append(
                    lint_records.render_diagnostic(
                        size_rule(relative_path),
                        relative_path,
                        f"{line_count} lines (max {max_lines}, "
                        f"ratcheted at {entry.max_lines} in "
                        f"lints/{entry.owner}/ratchets.toml)",
                    )
                )
            elif line_count < entry.max_lines:
                stale.append(
                    f"{relative_path} ratchet={entry.max_lines} "
                    f"observed={line_count} max={max_lines} "
                    f"(lints/{entry.owner}/ratchets.toml)"
                )
            continue

        diagnostics.append(
            lint_records.render_diagnostic(
                size_rule(relative_path),
                relative_path,
                f"{line_count} lines (max {max_lines})",
            )
        )

    stale.extend(
        sorted(
            f"{path} ratchet={entry.max_lines} observed=missing-file "
            f"(lints/{entry.owner}/ratchets.toml)"
            for path, entry in ratchet.items()
            if path not in seen_paths and not (REPO_ROOT / path).exists()
        )
    )

    if not diagnostics and not stale:
        print(
            "Max-lines check passed "
            f"(repo max {MAX_LINES}, component max {COMPONENT_MAX_LINES}, "
            "server layer maxes enabled)."
        )
        return 0

    if diagnostics:
        print(
            "Files above their max line threshold with no ratchet entry, "
            "or grown past the count their ratchet entry records:"
        )
        for diagnostic in diagnostics:
            print(diagnostic)
            print()

    if stale:
        print(
            "Stale max-lines ratchet entries — these files are now within their "
            "threshold (or gone); shrink or delete the entries in this change:"
        )
        for entry_line in sorted(stale):
            print(f"  {entry_line}")

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
