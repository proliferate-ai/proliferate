#!/usr/bin/env python3

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

try:
    from scripts.frontend_imports import ImportStatement, collect_module_specifiers
except ModuleNotFoundError:  # Direct `python3 scripts/...` execution.
    from frontend_imports import ImportStatement, collect_module_specifiers

REPO_ROOT = Path(__file__).resolve().parents[1]
MAX_LINES_ALLOWLIST_PATH = REPO_ROOT / "scripts" / "max_lines_allowlist.txt"
FRONTEND_STRUCTURE_ALLOWLIST_PATH = REPO_ROOT / "scripts" / "frontend_structure_allowlist.txt"
PRODUCT_CLIENT_SRC = REPO_ROOT / "apps" / "packages" / "product-client" / "src"
PRODUCT_CLIENT_DOMAIN_SRC = PRODUCT_CLIENT_SRC / "domain"
PRODUCT_CLIENT_PRIMITIVES_SRC = PRODUCT_CLIENT_SRC / "primitives"

FRONTEND_ROOTS = [
    REPO_ROOT / "apps" / "desktop" / "src",
    REPO_ROOT / "apps" / "web" / "src",
    REPO_ROOT / "apps" / "mobile" / "src",
    REPO_ROOT / "apps" / "packages" / "design" / "src",
    PRODUCT_CLIENT_SRC,
]

APP_ROOTS = [
    REPO_ROOT / "apps" / "desktop" / "src",
    REPO_ROOT / "apps" / "web" / "src",
    REPO_ROOT / "apps" / "mobile" / "src",
    # product-client is app-shaped (components/, hooks/, stores/), so the
    # component-.tsx-only and hook-responsibility-folder rules apply to it too.
    PRODUCT_CLIENT_SRC,
]

DOM_APP_AND_PACKAGE_ROOTS = [
    REPO_ROOT / "apps" / "desktop" / "src",
    REPO_ROOT / "apps" / "web" / "src",
    PRODUCT_CLIENT_SRC,
]

PACKAGE_ROOTS = {
    "design": REPO_ROOT / "apps" / "packages" / "design" / "src",
    # Classify both nested logical packages before the connected ProductClient
    # fallback so their stricter dependency contracts remain independent.
    "product-client-domain": PRODUCT_CLIENT_DOMAIN_SRC,
    # Classify the nested component library before the general ProductClient
    # fallback so it retains the former primitive-package dependency boundary.
    "product-client-primitives": PRODUCT_CLIENT_PRIMITIVES_SRC,
    "product-client": PRODUCT_CLIENT_SRC,
}

PRODUCT_CLIENT_DOMAIN_ALLOWED_ANYHARNESS_RUNTIME_IMPORTS = {
    "createTranscriptState",
    "deriveCanonicalPlan",
    "parseToolBackgroundWork",
    "reduceEvents",
}
PRODUCT_CLIENT_DOMAIN_RAW_CLOUD_CLIENT_IMPORTS = {
    "CreateProliferateClientOptions",
    "ProliferateCloudClient",
    "ProliferateOpenApiClient",
}
PRODUCT_CLIENT_DOMAIN_RAW_ANYHARNESS_CLIENT_CORE_IMPORTS = {
    "AnyHarnessClient",
    "AnyHarnessClientOptions",
    "AnyHarnessError",
    "AnyHarnessMeasurementOperationId",
    "AnyHarnessRequestOptions",
    "AnyHarnessRequestStartEvent",
    "AnyHarnessRequestTimingLifecycle",
    "AnyHarnessTimingCategory",
    "AnyHarnessTimingEvent",
    "AnyHarnessTimingObserver",
    "AnyHarnessTimingScope",
    "AnyHarnessTransport",
}
PRODUCT_CLIENT_DOMAIN_STYLE_SUFFIXES = {
    ".css",
    ".less",
    ".sass",
    ".scss",
    ".styl",
}

EXTENSIONS = {".ts", ".tsx"}
RAW_DOM_TAGS = ("button", "input", "label", "select", "textarea")
RAW_DOM_TAG_RE = re.compile(r"<\s*(" + "|".join(RAW_DOM_TAGS) + r")\b")

COMPONENT_DEFINITION_RES = [
    re.compile(r"\b(?:export\s+)?function\s+([A-Z][A-Za-z0-9_]*)\b"),
    re.compile(r"\b(?:export\s+)?const\s+([A-Z][A-Za-z0-9_]*)\s*="),
    re.compile(r"\b(?:export\s+)?class\s+([A-Z][A-Za-z0-9_]*)\b"),
]
TYPE_DEFINITION_RE = re.compile(r"^\s*(?:export\s+)?(?:interface|type)\s+([A-Za-z0-9_]+)\b")

PRIMITIVE_EXACT_NAMES = {
    "Button",
    "IconButton",
    "Input",
    "Textarea",
    "Label",
    "Select",
    "Checkbox",
    "Switch",
    "Tabs",
    "Menu",
    "MenuItem",
    "Popover",
    "Tooltip",
    "Dialog",
    "Modal",
    "Badge",
    "Pill",
    "Separator",
    "ScrollArea",
    "Shell",
    "Layout",
}

PRIMITIVE_SUFFIXES = (
    "IconButton",
    "Button",
    "Input",
    "Textarea",
    "Label",
    "Select",
    "Checkbox",
    "Switch",
    "Tabs",
    "Menu",
    "MenuItem",
    "Popover",
    "Tooltip",
    "Dialog",
    "Modal",
    "Badge",
    "Pill",
    "Separator",
    "ScrollArea",
    "Shell",
)

PRIMITIVE_DEFINITION_CONTEXT_LINES = 14

NATIVE_DOM_CONTRACT_RE = re.compile(
    r"\b("
    r"ButtonHTMLAttributes|InputHTMLAttributes|TextareaHTMLAttributes|"
    r"SelectHTMLAttributes|LabelHTMLAttributes|HTMLButtonElement|"
    r"HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement|HTMLLabelElement|"
    r"ComponentProps\s*<\s*['\"](?:button|input|textarea|select|label)['\"]"
    r")\b"
)

CANONICAL_PRODUCT_HOOK_FOLDERS = {
    "cache",
    "derived",
    "facade",
    "lifecycle",
    "ui",
    "workflows",
}

SPECIAL_HOOK_ROOTS = {"access", "ui"}

LINE_SOFT_THRESHOLD = 400
LINE_STRONG_REASON_THRESHOLD = 600
JUNK_DRAWER_BASENAMES = {
    "common.ts",
    "common.tsx",
    "helper.ts",
    "helper.tsx",
    "helpers.ts",
    "helpers.tsx",
    "misc.ts",
    "misc.tsx",
    "util.ts",
    "util.tsx",
    "utils.ts",
    "utils.tsx",
}

RULE_ORDER = [
    "RAW_DOM_CONTROL",
    "PRIMITIVE_DEFINITION_OUTSIDE_UI",
    "COMPONENT_TS_FILE",
    "PRODUCT_HOOK_DIRECT_FILE",
    "NONSTANDARD_HOOK_FOLDER",
    "FRONTEND_JUNK_DRAWER_FILENAME",
    "FORBIDDEN_SHARED_PACKAGE_IMPORT",
    "LARGE_FRONTEND_FILE",
]

RULE_TITLES = {
    "RAW_DOM_CONTROL": "Raw DOM controls outside ProductClient primitives",
    "PRIMITIVE_DEFINITION_OUTSIDE_UI": "Primitive definitions outside ProductClient primitives",
    "COMPONENT_TS_FILE": ".ts files under components/**",
    "PRODUCT_HOOK_DIRECT_FILE": "Product hooks directly under hooks/<domain>/",
    "NONSTANDARD_HOOK_FOLDER": "Nonstandard product hook responsibility folders",
    "FRONTEND_JUNK_DRAWER_FILENAME": "Generic frontend junk-drawer filenames",
    "FORBIDDEN_SHARED_PACKAGE_IMPORT": "Forbidden shared-package imports",
    "LARGE_FRONTEND_FILE": "Large frontend files over documented thresholds",
}


@dataclass(frozen=True)
class Violation:
    rule_id: str
    path: Path
    lineno: int
    message: str

    @property
    def relative_path(self) -> str:
        return self.path.relative_to(REPO_ROOT).as_posix()

    def format(self) -> str:
        return f"{self.relative_path}:{self.lineno}: {self.message}"


def relative(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


def is_under(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def should_skip(path: Path) -> bool:
    relative_path = relative(path)
    if "/generated/" in f"/{relative_path}" or "/dist/" in f"/{relative_path}":
        return True
    if (
        path.name.endswith(".d.ts")
        or ".generated." in path.name
        or ".test." in path.name
        or ".spec." in path.name
    ):
        return True
    return any(part in {"__tests__", "__mocks__"} for part in path.parts)


def iter_source_files(roots: Iterable[Path] = FRONTEND_ROOTS) -> list[Path]:
    files: list[Path] = []
    for root in roots:
        if not root.exists():
            continue
        for path in sorted(root.rglob("*")):
            if path.is_file() and path.suffix in EXTENSIONS and not should_skip(path):
                files.append(path)
    return files


def count_lines(path: Path) -> int:
    data = path.read_bytes()
    if not data:
        return 0
    return data.count(b"\n") + (0 if data.endswith(b"\n") else 1)


def load_max_lines_allowlist_paths() -> set[str]:
    paths: set[str] = set()
    if not MAX_LINES_ALLOWLIST_PATH.exists():
        return paths
    for raw_line in MAX_LINES_ALLOWLIST_PATH.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split(maxsplit=2)
        if len(parts) == 3:
            paths.add(parts[0])
    return paths


@dataclass(frozen=True)
class LargeFileAllowlistEntry:
    path: str
    max_lines: int
    reason: str


def load_large_file_allowlist() -> dict[str, LargeFileAllowlistEntry]:
    entries: dict[str, LargeFileAllowlistEntry] = {}
    if not FRONTEND_STRUCTURE_ALLOWLIST_PATH.exists():
        return entries
    relative_allowlist = FRONTEND_STRUCTURE_ALLOWLIST_PATH.relative_to(REPO_ROOT)
    for line_number, raw_line in enumerate(
        FRONTEND_STRUCTURE_ALLOWLIST_PATH.read_text().splitlines(), start=1
    ):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split(maxsplit=2)
        if len(parts) != 3:
            raise ValueError(f"{relative_allowlist}:{line_number}: expected path max_lines reason")
        entry_path, raw_max_lines, reason = parts
        try:
            max_lines = int(raw_max_lines)
        except ValueError as exc:
            raise ValueError(
                f"{relative_allowlist}:{line_number}: max_lines must be an integer"
            ) from exc
        if max_lines < 1:
            raise ValueError(f"{relative_allowlist}:{line_number}: max_lines must be positive")
        if entry_path in entries:
            raise ValueError(f"{relative_allowlist}:{line_number}: duplicate allowlist entry")
        entries[entry_path] = LargeFileAllowlistEntry(entry_path, max_lines, reason)
    return entries


def line_is_comment(line: str) -> bool:
    stripped = line.strip()
    return stripped.startswith("//") or stripped.startswith("*") or stripped.startswith("/*")


def is_primitive_like_name(name: str) -> bool:
    return name in PRIMITIVE_EXACT_NAMES or name.endswith(PRIMITIVE_SUFFIXES)


def native_dom_type_names(lines: list[str]) -> set[str]:
    names: set[str] = set()
    for index, line in enumerate(lines):
        match = TYPE_DEFINITION_RE.match(line)
        if not match:
            continue
        context = "\n".join(lines[index : index + PRIMITIVE_DEFINITION_CONTEXT_LINES + 1])
        if NATIVE_DOM_CONTRACT_RE.search(context):
            names.add(match.group(1))
    return names


def component_definition_context(lines: list[str], index: int) -> str:
    end = min(len(lines), index + PRIMITIVE_DEFINITION_CONTEXT_LINES + 1)
    context_lines: list[str] = []
    for line in lines[index:end]:
        context_lines.append(line)
        if re.search(r"\)\s*(?:=>\s*)?\{", line):
            break
    return "\n".join(context_lines)


def has_native_dom_contract_for(
    name: str,
    context: str,
    native_type_names: set[str],
) -> bool:
    if name in PRIMITIVE_EXACT_NAMES:
        return True
    if NATIVE_DOM_CONTRACT_RE.search(context):
        return True
    return any(
        re.search(rf"\b{re.escape(type_name)}\b", context) for type_name in native_type_names
    )


def find_raw_dom_controls(files: Iterable[Path]) -> list[Violation]:
    violations: list[Violation] = []
    for path in files:
        if path.suffix != ".tsx" or not any(
            is_under(path, root) for root in DOM_APP_AND_PACKAGE_ROOTS
        ):
            continue
        if is_under(path, PRODUCT_CLIENT_PRIMITIVES_SRC):
            continue
        for lineno, line in enumerate(path.read_text().splitlines(), start=1):
            if line_is_comment(line):
                continue
            match = RAW_DOM_TAG_RE.search(line)
            if match:
                tag = match.group(1)
                violations.append(
                    Violation(
                        "RAW_DOM_CONTROL",
                        path,
                        lineno,
                        f"raw <{tag}> should use a ProductClient primitive",
                    )
                )
    return violations


def find_primitive_definitions(files: Iterable[Path]) -> list[Violation]:
    violations: list[Violation] = []
    for path in files:
        if path.suffix != ".tsx" or not any(
            is_under(path, root) for root in DOM_APP_AND_PACKAGE_ROOTS
        ):
            continue
        if is_under(path, PRODUCT_CLIENT_PRIMITIVES_SRC):
            continue
        text = path.read_text()
        lines = text.splitlines()
        native_type_names = native_dom_type_names(lines)
        reported_names: set[str] = set()
        for index, line in enumerate(lines):
            if line_is_comment(line):
                continue
            for pattern in COMPONENT_DEFINITION_RES:
                match = pattern.search(line)
                if not match:
                    continue
                name = match.group(1)
                if name in reported_names:
                    break
                context = component_definition_context(lines, index)
                # Keep this category narrow: product components that merely render controls
                # are reported by RAW_DOM_CONTROL instead of being labeled primitives.
                if is_primitive_like_name(name) and has_native_dom_contract_for(
                    name, context, native_type_names
                ):
                    reported_names.add(name)
                    violations.append(
                        Violation(
                            "PRIMITIVE_DEFINITION_OUTSIDE_UI",
                            path,
                            index + 1,
                            (
                                f"{name} looks like a DOM primitive definition "
                                "outside apps/packages/product-client/src/primitives/**"
                            ),
                        )
                    )
                break
    return violations


def find_component_ts_files(files: Iterable[Path]) -> list[Violation]:
    violations: list[Violation] = []
    for path in files:
        if path.suffix != ".ts":
            continue
        if not any(is_under(path, root / "components") for root in APP_ROOTS):
            continue
        violations.append(
            Violation(
                "COMPONENT_TS_FILE",
                path,
                1,
                "components/** is .tsx-only; move non-UI logic to config, copy, or lib/domain",
            )
        )
    return violations


def find_hook_shape_violations() -> list[Violation]:
    violations: list[Violation] = []
    for root in APP_ROOTS:
        hooks_root = root / "hooks"
        if not hooks_root.exists():
            continue
        for domain_path in sorted(path for path in hooks_root.iterdir() if path.is_dir()):
            domain = domain_path.name
            if domain in SPECIAL_HOOK_ROOTS:
                continue
            for child in sorted(domain_path.iterdir()):
                if child.is_file() and child.suffix in EXTENSIONS and not should_skip(child):
                    violations.append(
                        Violation(
                            "PRODUCT_HOOK_DIRECT_FILE",
                            child,
                            1,
                            (
                                "hook files should live under a responsibility folder "
                                "such as derived, workflows, lifecycle, ui, cache, or facade"
                            ),
                        )
                    )
                elif child.is_dir() and child.name not in CANONICAL_PRODUCT_HOOK_FOLDERS:
                    violations.append(
                        Violation(
                            "NONSTANDARD_HOOK_FOLDER",
                            child,
                            1,
                            (
                                f"hooks/{domain}/{child.name}/ is not one of the "
                                "documented product hook responsibility folders"
                            ),
                        )
                    )
    return violations


def find_junk_drawer_filename_violations(files: Iterable[Path]) -> list[Violation]:
    return [
        Violation(
            "FRONTEND_JUNK_DRAWER_FILENAME",
            path,
            1,
            "name the owned concept instead of using a generic junk-drawer filename",
        )
        for path in files
        if is_under(path, PRODUCT_CLIENT_SRC) and path.name in JUNK_DRAWER_BASENAMES
    ]


def resolved_relative_import_leaves_package(path: Path, package_root: Path, source: str) -> bool:
    if not source.startswith("."):
        return False
    resolved = (path.parent / source).resolve()
    try:
        resolved.relative_to(package_root.resolve())
    except ValueError:
        return True
    return False


def product_client_domain_raw_capability_names(
    source: str, statement: ImportStatement
) -> set[str]:
    imported_names = set(statement.imported_names)
    if "*" in imported_names:
        return {"*"}
    if source == "@proliferate/cloud-sdk":
        return imported_names & PRODUCT_CLIENT_DOMAIN_RAW_CLOUD_CLIENT_IMPORTS
    if source == "@anyharness/sdk":
        return (
            imported_names
            & PRODUCT_CLIENT_DOMAIN_RAW_ANYHARNESS_CLIENT_CORE_IMPORTS
        )
    return set()


def forbidden_import_reason(package_name: str, statement: ImportStatement) -> str | None:
    source = statement.source

    if source.startswith("@/"):
        return "shared packages must not import app-root aliases"
    if (
        source.startswith("apps/desktop/")
        or source.startswith("apps/web/")
        or source.startswith("apps/mobile/")
    ):
        return "shared packages must not import app internals"
    if source.startswith("@tauri-apps/"):
        return "shared packages in this layer must not import Tauri APIs"
    if source in {"react-native"} or source.startswith("react-native/"):
        return "DOM shared packages must not import React Native"

    if package_name == "design":
        if source in {"react", "react-dom"} or source.startswith("react-dom/"):
            return "design must not import React or DOM components"
        if source.startswith("@proliferate/product-"):
            return "design must not import product package code"
        if source.startswith("@proliferate/cloud-sdk") or source.startswith("@anyharness/sdk"):
            return "design must not import SDK clients or contracts"
        if source == "@tanstack/react-query":
            return "design must not import query clients"
        return None

    if package_name == "product-client-primitives":
        if source.startswith("#product/"):
            target = source.removeprefix("#product/")
            if target == "primitives" or target.startswith("primitives/"):
                return None
            return "ProductClient primitives must not import higher ProductClient layers"
        if source.startswith("@proliferate/product-client/internal/"):
            target = source.removeprefix("@proliferate/product-client/internal/")
            if target == "primitives" or target.startswith("primitives/"):
                return None
            return "ProductClient primitives must not import higher ProductClient layers"
        if source.startswith("@proliferate/product-client"):
            return "ProductClient primitives must not import the connected ProductClient surface"
        if source.startswith("@proliferate/cloud-sdk") or source.startswith(
            "@anyharness/sdk"
        ):
            return "ProductClient primitives must not import SDK clients or contracts"
        if source.startswith("@tanstack/react-query"):
            return "ProductClient primitives must not import query clients"
        return None

    if package_name == "product-client-domain":
        clean_source = source.split("?", 1)[0].split("#", 1)[0]
        if Path(clean_source).suffix.lower() in PRODUCT_CLIENT_DOMAIN_STYLE_SUFFIXES:
            return "ProductClient domain must not import CSS or style assets"
        if source.startswith("."):
            return None
        if source in {"@proliferate/cloud-sdk", "@anyharness/sdk"}:
            raw_capabilities = product_client_domain_raw_capability_names(
                source, statement
            )
            if raw_capabilities:
                return (
                    "ProductClient domain may import SDK data contracts, not raw "
                    "client, request, timing, or transport plumbing; forbidden "
                    f"imports: {', '.join(sorted(raw_capabilities))}"
                )
        if source == "@proliferate/cloud-sdk":
            if statement.runtime_imported_names:
                return "ProductClient domain may import Cloud SDK contract types, not runtime values"
            return None
        if source == "@anyharness/sdk":
            forbidden_runtime = (
                set(statement.runtime_imported_names)
                - PRODUCT_CLIENT_DOMAIN_ALLOWED_ANYHARNESS_RUNTIME_IMPORTS
            )
            if forbidden_runtime:
                return (
                    "ProductClient domain may import AnyHarness contract types and the four "
                    "approved pure helpers only; forbidden runtime imports: "
                    f"{', '.join(sorted(forbidden_runtime))}"
                )
            return None
        return (
            "ProductClient domain external imports are limited to Cloud SDK types and "
            "AnyHarness contract types/approved pure helpers"
        )

    if package_name == "product-client":
        # product-client is the shared connected product. It may depend in the
        # correct direction on shared packages and SDKs, but must never reach
        # into either host (apps/desktop, apps/web) or Tauri. The generic checks
        # above already reject app-root aliases, app-internal imports, Tauri
        # packages, and React Native for every package.
        return None

    return None


def find_forbidden_shared_package_imports(files: Iterable[Path]) -> list[Violation]:
    violations: list[Violation] = []
    for path in files:
        package_name = next(
            (name for name, root in PACKAGE_ROOTS.items() if is_under(path, root)),
            None,
        )
        if package_name is None:
            continue
        package_root = PACKAGE_ROOTS[package_name]
        text = path.read_text()
        for statement in collect_module_specifiers(path, text):
            reason = forbidden_import_reason(package_name, statement)
            if reason is None and resolved_relative_import_leaves_package(
                path, package_root, statement.source
            ):
                reason = (
                    "shared packages must not reach outside their package src/ tree "
                    "with relative imports"
                )
            if reason is None:
                continue
            violations.append(
                Violation(
                    "FORBIDDEN_SHARED_PACKAGE_IMPORT",
                    path,
                    statement.lineno,
                    (
                        f"{package_name} import {statement.source!r} violates "
                        f"package dependency rules: {reason}"
                    ),
                )
            )
    return violations


def find_large_frontend_files(files: Iterable[Path]) -> list[Violation]:
    violations: list[Violation] = []
    documented_large_files = load_max_lines_allowlist_paths()
    allowlist = load_large_file_allowlist()
    observed: dict[str, int] = {}
    for path in files:
        relative_path = relative(path)
        if relative_path in documented_large_files:
            continue
        line_count = count_lines(path)
        observed[relative_path] = line_count
        if line_count <= LINE_SOFT_THRESHOLD:
            continue
        entry = allowlist.get(relative_path)
        if entry is not None and line_count <= entry.max_lines:
            continue
        if line_count >= LINE_STRONG_REASON_THRESHOLD:
            threshold_note = (
                f"{line_count} lines; files at {LINE_STRONG_REASON_THRESHOLD}+ lines "
                "need a strong reason to stay whole"
            )
        else:
            threshold_note = (
                f"{line_count} lines; frontend docs prefer splitting before roughly "
                f"{LINE_SOFT_THRESHOLD} lines"
            )
        if entry is not None:
            threshold_note += f" (exceeds allowlisted {entry.max_lines})"
        violations.append(
            Violation(
                "LARGE_FRONTEND_FILE",
                path,
                1,
                threshold_note,
            )
        )

    # Ratchet: an allowlisted file that dropped back under the threshold (or was
    # deleted) makes its entry stale and must be removed, mirroring the
    # max_lines_allowlist contract.
    for entry_path, entry in allowlist.items():
        line_count = observed.get(entry_path)
        if line_count is None:
            if entry_path in documented_large_files:
                continue
            if not (REPO_ROOT / entry_path).exists():
                violations.append(
                    Violation(
                        "LARGE_FRONTEND_FILE",
                        REPO_ROOT / entry_path,
                        1,
                        (
                            "stale frontend-structure allowlist entry; file no longer "
                            f"scanned/present (allowlisted {entry.max_lines}); remove it"
                        ),
                    )
                )
            continue
        if line_count <= LINE_SOFT_THRESHOLD:
            violations.append(
                Violation(
                    "LARGE_FRONTEND_FILE",
                    REPO_ROOT / entry_path,
                    1,
                    (
                        f"stale frontend-structure allowlist entry; file is now {line_count} "
                        f"lines (<= {LINE_SOFT_THRESHOLD}) and allowlisted {entry.max_lines}; "
                        "remove it"
                    ),
                )
            )
    return violations


def collect_violations() -> list[Violation]:
    files = iter_source_files()
    violations: list[Violation] = []
    violations.extend(find_raw_dom_controls(files))
    violations.extend(find_primitive_definitions(files))
    violations.extend(find_component_ts_files(files))
    violations.extend(find_hook_shape_violations())
    violations.extend(find_junk_drawer_filename_violations(files))
    violations.extend(find_forbidden_shared_package_imports(files))
    violations.extend(find_large_frontend_files(files))
    return sorted(
        violations,
        key=lambda violation: (
            RULE_ORDER.index(violation.rule_id),
            violation.relative_path,
            violation.lineno,
            violation.message,
        ),
    )


def print_report(violations: list[Violation], *, strict: bool, summary_only: bool) -> None:
    files = iter_source_files()
    counts = Counter(violation.rule_id for violation in violations)
    total = sum(counts.values())

    print("Frontend structure report (report-only by default)")
    print(f"Scanned {len(files)} non-test frontend source files.")
    if strict:
        print("Strict mode is on; the command returns a non-zero exit code when violations exist.")
    else:
        print(
            "Strict mode is off; use --strict to return a non-zero exit code when "
            "the report contains violations."
        )
    print()
    print("Summary:")
    for rule_id in RULE_ORDER:
        print(f"  {rule_id}: {counts.get(rule_id, 0)}")
    print(f"  TOTAL: {total}")

    if summary_only or not violations:
        return

    for rule_id in RULE_ORDER:
        rule_violations = [violation for violation in violations if violation.rule_id == rule_id]
        if not rule_violations:
            continue
        print()
        print(f"{rule_id} - {RULE_TITLES[rule_id]} ({len(rule_violations)})")
        for violation in rule_violations:
            print(f"  {violation.format()}")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Print a grouped frontend structure drift inventory. The command is "
            "report-only by default so migration workstreams can shrink the "
            "inventory before CI enforcement is enabled."
        )
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="fail with exit code 1 when any report category has violations",
    )
    parser.add_argument(
        "--summary-only",
        action="store_true",
        help="print only grouped counts, not per-path inventory entries",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    violations = collect_violations()
    print_report(violations, strict=args.strict, summary_only=args.summary_only)
    if args.strict and violations:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
