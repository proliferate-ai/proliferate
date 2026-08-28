#!/usr/bin/env python3
"""System MANIFEST checker (server plane).

Per the Organization Standard, every system folder carries a `MANIFEST.toml`
declaring: what the system owns, its public surface, who may import it, and
the spec that governs it. Two records under `lints/product/manifests.toml`
own the rules:

- PROD-MANIFEST-001: every server system folder carries a MANIFEST.toml that
  parses, carries the required fields, and points `spec` at a file that
  exists. Coverage = every top-level domain under `server/proliferate/server/`
  (minus the `cloud` megadomain, whose four live systems — spread over six
  subfolders — are manifested at those subfolders) plus those live cloud
  system folders.
- PROD-MANIFEST-002: a manifest's `allowed_importers` equals the measured
  importer set exactly — a real importer missing from the list and a listed
  importer that no longer imports are both failures, so the declaration always
  equals reality (zero aspirational entries).

Importers are measured over `server/proliferate/**` (the shipped package;
`server/tests/` is outside it) as absolute `proliferate.server.<...>` imports —
the import style the server standards mandate. An importer's label is the
top-level domain it belongs to (`accounts`), `cloud/<sub>` for the cloud
subsystems, the bare filename for package-root modules (`main.py`), or the
first path segment for code outside `server/` (`background`, `integrations`).

`--warn` reports everything and exits 0: the checker's non-blocking
introduction mode, dropped when the declarations are ready to enforce.
"""

from __future__ import annotations

import argparse
import re
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    # Run as `python3 scripts/check_manifests.py` from the repo root,
    # sys.path[0] is scripts/ — the shared loader lives one level up.
    sys.path.insert(0, str(REPO_ROOT))

from scripts import lint_records  # noqa: E402  (path shim must precede the import)

CHECKER = "scripts/check_manifests.py"
PACKAGE_RELATIVE = ("server", "proliferate")
SERVER_RELATIVE = (*PACKAGE_RELATIVE, "server")
SCHEMA_RULE = "PROD-MANIFEST-001"
IMPORTERS_RULE = "PROD-MANIFEST-002"
MANIFEST_NAME = "MANIFEST.toml"

# The cloud megadomain never gets its own manifest: it is a folder of systems,
# not a system. Its live subsystems are manifested individually below; if the
# folder ever dissolves, this special case goes with it.
SKIPPED_DOMAINS = {"cloud"}
REQUIRED_CLOUD_SYSTEMS = (
    "agent_gateway",
    "integrations",
    "integration_gateway",
    "worker",
    "runtime_workers",
    "github_app",
)

REQUIRED_STRING_FIELDS = ("name", "spec", "owns")
REQUIRED_LIST_FIELDS = ("public_surface", "allowed_importers")

RULES = lint_records.load("product")


@dataclass(frozen=True)
class Violation:
    rule_id: str
    relative_path: str
    site: str
    detail: str

    def format(self) -> str:
        """The record-generated diagnostic: rule, alternative, record path."""
        return lint_records.render_diagnostic(
            RULES.rule(self.rule_id),
            self.relative_path,
            self.detail,
        )


def system_folders(base: Path) -> list[Path]:
    """Every folder that must carry a MANIFEST.toml, repo-rooted at `base`."""
    server_root = base.joinpath(*SERVER_RELATIVE)
    if not server_root.is_dir():
        raise SystemExit(f"{CHECKER}: missing server tree {server_root}")
    folders = [
        entry
        for entry in sorted(server_root.iterdir())
        if entry.is_dir() and not entry.name.startswith("__") and entry.name not in SKIPPED_DOMAINS
    ]
    cloud_root = server_root / "cloud"
    if cloud_root.is_dir():
        for name in REQUIRED_CLOUD_SYSTEMS:
            folder = cloud_root / name
            if folder.is_dir():
                folders.append(folder)
    return folders


def importer_label(relative_to_package: Path) -> str:
    """The declared-importer label for a file under server/proliferate/."""
    parts = relative_to_package.parts
    if parts[0] == "server":
        if len(parts) == 2:
            return parts[1]  # package-root module, e.g. main.py
        if parts[1] == "cloud" and len(parts) >= 3 and not parts[2].endswith(".py"):
            return f"cloud/{parts[2]}"
        return parts[1]
    return parts[0]


def folder_label(relative_to_server: Path) -> str:
    """The label a manifested folder's own code carries (for self-exclusion)."""
    parts = relative_to_server.parts
    if parts[0] == "cloud" and len(parts) >= 2:
        return f"cloud/{parts[1]}"
    return parts[0]


def measure_importers(base: Path, folders: list[Path]) -> dict[Path, set[str]]:
    """Actual importer labels per manifested folder, one package scan."""
    package_root = base.joinpath(*PACKAGE_RELATIVE)
    server_root = base.joinpath(*SERVER_RELATIVE)
    module_prefixes = {
        folder: "proliferate.server." + ".".join(folder.relative_to(server_root).parts)
        for folder in folders
    }
    patterns = {
        folder: re.compile(rf"(?:from|import)\s+{re.escape(prefix)}(?![A-Za-z0-9_])")
        for folder, prefix in module_prefixes.items()
    }
    importers: dict[Path, set[str]] = {folder: set() for folder in folders}
    for path in package_root.rglob("*.py"):
        relative = path.relative_to(package_root)
        text = path.read_text(encoding="utf-8", errors="replace")
        label = importer_label(relative)
        for folder, pattern in patterns.items():
            if not pattern.search(text):
                continue
            own = folder_label(folder.relative_to(server_root))
            if label == own:
                continue
            # Files inside a manifested cloud subsystem carry the cloud/<sub>
            # label; a sibling domain file directly under cloud/ carries the
            # bare "cloud" label and counts as an importer.
            importers[folder].add(label)
    return importers


def collect_violations(root: Path | None = None) -> list[Violation]:
    base = Path(root).resolve() if root is not None else REPO_ROOT
    folders = system_folders(base)
    violations: list[Violation] = []
    valid: list[Path] = []

    for folder in folders:
        relative_folder = folder.relative_to(base).as_posix()
        manifest_path = folder / MANIFEST_NAME
        if not manifest_path.is_file():
            violations.append(
                Violation(
                    SCHEMA_RULE,
                    relative_folder,
                    "missing-manifest",
                    f"system folder has no {MANIFEST_NAME}",
                )
            )
            continue
        relative_manifest = manifest_path.relative_to(base).as_posix()
        try:
            data = tomllib.loads(manifest_path.read_text(encoding="utf-8"))
        except tomllib.TOMLDecodeError as error:
            violations.append(
                Violation(
                    SCHEMA_RULE,
                    relative_manifest,
                    "malformed-toml",
                    f"malformed TOML: {error}",
                )
            )
            continue
        broken = False
        for field in REQUIRED_STRING_FIELDS:
            if not isinstance(data.get(field), str) or not data[field].strip():
                violations.append(
                    Violation(
                        SCHEMA_RULE,
                        relative_manifest,
                        f"field::{field}",
                        f"missing or empty required string field {field!r}",
                    )
                )
                broken = True
        for field in REQUIRED_LIST_FIELDS:
            value = data.get(field)
            if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
                violations.append(
                    Violation(
                        SCHEMA_RULE,
                        relative_manifest,
                        f"field::{field}",
                        f"missing required list-of-strings field {field!r}",
                    )
                )
                broken = True
        if broken:
            continue
        if not (base / data["spec"]).is_file():
            violations.append(
                Violation(
                    SCHEMA_RULE,
                    relative_manifest,
                    "spec::missing",
                    f"spec {data['spec']!r} is not a file in the repository",
                )
            )
            continue
        valid.append(folder)

    measured = measure_importers(base, valid)
    for folder in valid:
        manifest_path = folder / MANIFEST_NAME
        relative_manifest = manifest_path.relative_to(base).as_posix()
        data = tomllib.loads(manifest_path.read_text(encoding="utf-8"))
        declared = set(data["allowed_importers"])
        actual = measured[folder]
        for label in sorted(actual - declared):
            violations.append(
                Violation(
                    IMPORTERS_RULE,
                    relative_manifest,
                    f"allowed_importers::missing::{label}",
                    f"{label!r} imports this system but is not declared in allowed_importers",
                )
            )
        for label in sorted(declared - actual):
            violations.append(
                Violation(
                    IMPORTERS_RULE,
                    relative_manifest,
                    f"allowed_importers::stale::{label}",
                    f"{label!r} is declared in allowed_importers but no longer "
                    f"imports this system — remove the entry",
                )
            )
    return violations


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--warn",
        action="store_true",
        help="report violations without failing (non-blocking introduction mode)",
    )
    args = parser.parse_args(argv)

    violations = collect_violations()
    if not violations:
        print(f"{CHECKER}: OK — every manifest present, valid, and reality-exact")
        return 0

    for violation in violations:
        print(violation.format())
        print()
    if args.warn:
        print(
            f"{CHECKER}: WARN MODE — {len(violations)} problem(s) reported, not "
            f"failing (drop --warn to enforce)"
        )
        return 0
    print(f"{CHECKER}: {len(violations)} problem(s)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
