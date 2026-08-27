#!/usr/bin/env python3
"""Prove Mobile reaches only ProductClient's built, headless domain graph.

The rules themselves are records under `lints/frontend/exports.toml`
(FE-EXPORT-1..9); this file is only the engine that proves them. Every
diagnostic is rendered from its record, so rule wording lives with the rule.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import unquote

try:
    from scripts import lint_records
    from scripts.frontend_imports import collect_module_specifiers
except ModuleNotFoundError:  # Direct `python3 scripts/...` execution.
    import lint_records
    from frontend_imports import collect_module_specifiers


REPO_ROOT = Path(__file__).resolve().parents[1]
RULES = lint_records.load("frontend")
PRODUCT_CLIENT_DOMAIN_PREFIX = "@proliferate/product-client/internal/domain/"
PRODUCT_CLIENT_PACKAGE = "@proliferate/product-client"


def display_path(path: Path, repo_root: Path = REPO_ROOT) -> str:
    """Repo-relative when possible; absolute otherwise (tests use temp roots)."""
    try:
        return path.relative_to(repo_root).as_posix()
    except ValueError:
        return path.as_posix()


def diagnostic(rule_id: str, location: str, detail: str) -> str:
    return lint_records.render_diagnostic(RULES.rule(rule_id), location, detail)


EXPECTED_METRO_CONDITIONS = {
    "ios": ["react-native"],
    "android": ["react-native"],
    "web": ["browser"],
}

METRO_FACTS_SCRIPT = r"""
const config = require("./metro.config.js");
const resolver = config && config.resolver ? config.resolver : {};
process.stdout.write(JSON.stringify({
  resolveRequest:
    resolver.resolveRequest == null ? null : typeof resolver.resolveRequest,
  unstable_enablePackageExports: resolver.unstable_enablePackageExports,
  unstable_conditionNames: resolver.unstable_conditionNames,
  unstable_conditionsByPlatform: resolver.unstable_conditionsByPlatform,
}));
"""


@dataclass(frozen=True)
class MobileEdge:
    path: Path
    lineno: int
    source: str
    type_only: bool

    def format(self, rule_id: str, detail: str, *, repo_root: Path) -> str:
        location = f"{display_path(self.path, repo_root)}:{self.lineno}"
        return diagnostic(rule_id, location, detail)


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError as error:
        raise ValueError(f"missing required file: {path}") from error
    except json.JSONDecodeError as error:
        raise ValueError(
            f"{path}:{error.lineno}:{error.colno}: invalid JSON: {error.msg}"
        ) from error


def clean_module_source(source: str) -> str:
    return source.split("?", 1)[0].split("#", 1)[0]


def relative_import_targets_product_client(path: Path, source: str, *, repo_root: Path) -> bool:
    if not source.startswith("."):
        return False
    resolved = (path.parent / clean_module_source(source)).resolve()
    product_client_root = (repo_root / "apps" / "packages" / "product-client").resolve()
    try:
        resolved.relative_to(product_client_root)
    except ValueError:
        return False
    return True


def collect_mobile_edges(repo_root: Path = REPO_ROOT) -> list[MobileEdge]:
    mobile_src = repo_root / "apps" / "mobile" / "src"
    edges: list[MobileEdge] = []
    if not mobile_src.is_dir():
        return edges
    for path in sorted(mobile_src.rglob("*")):
        if not path.is_file() or path.suffix not in {".ts", ".tsx"}:
            continue
        for statement in collect_module_specifiers(path, path.read_text()):
            package_edge = (
                statement.source == PRODUCT_CLIENT_PACKAGE
                or statement.source.startswith(f"{PRODUCT_CLIENT_PACKAGE}/")
            )
            relative_edge = relative_import_targets_product_client(
                path, statement.source, repo_root=repo_root
            )
            if not package_edge and not relative_edge:
                continue
            edges.append(
                MobileEdge(
                    path=path,
                    lineno=statement.lineno,
                    source=statement.source,
                    type_only=statement.type_only,
                )
            )
    return edges


def validate_mobile_tsconfig(repo_root: Path = REPO_ROOT) -> list[str]:
    path = repo_root / "apps" / "mobile" / "tsconfig.json"
    location = display_path(path, repo_root)
    config = read_json(path)
    if not isinstance(config, dict):
        return [diagnostic("FE-EXPORT-1", location, "expected a JSON object")]
    compiler_options = config.get("compilerOptions", {})
    if not isinstance(compiler_options, dict):
        return [diagnostic("FE-EXPORT-1", location, "compilerOptions must be an object")]

    errors: list[str] = []
    if "baseUrl" in compiler_options:
        errors.append(
            diagnostic(
                "FE-EXPORT-1",
                location,
                "compilerOptions.baseUrl must be absent so Expo cannot intercept package exports",
            )
        )
    if "paths" in compiler_options:
        errors.append(
            diagnostic(
                "FE-EXPORT-1",
                location,
                "compilerOptions.paths must be absent so Expo cannot "
                "resolve ProductClient source aliases",
            )
        )
    return errors


def load_effective_metro_facts(repo_root: Path = REPO_ROOT) -> dict[str, Any]:
    mobile_root = repo_root / "apps" / "mobile"
    result = subprocess.run(
        ["node", "-e", METRO_FACTS_SCRIPT],
        cwd=mobile_root,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "unknown Node error"
        raise ValueError(f"failed to load apps/mobile/metro.config.js: {detail}")
    try:
        facts = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise ValueError(
            f"apps/mobile/metro.config.js probe did not return valid JSON: {error.msg}"
        ) from error
    if not isinstance(facts, dict):
        raise ValueError("apps/mobile/metro.config.js probe returned a non-object")
    return facts


def validate_metro_facts(facts: dict[str, Any]) -> list[str]:
    location = "apps/mobile/metro.config.js"
    errors: list[str] = []
    if facts.get("resolveRequest") is not None:
        errors.append(
            diagnostic(
                "FE-EXPORT-2",
                location,
                "must not install a custom resolver.resolveRequest",
            )
        )
    if facts.get("unstable_enablePackageExports") is not True:
        errors.append(
            diagnostic(
                "FE-EXPORT-3",
                location,
                "Metro resolver.unstable_enablePackageExports must be exactly true",
            )
        )
    if facts.get("unstable_conditionNames") != []:
        errors.append(
            diagnostic(
                "FE-EXPORT-3",
                location,
                "Metro resolver.unstable_conditionNames must be exactly []",
            )
        )
    if facts.get("unstable_conditionsByPlatform") != EXPECTED_METRO_CONDITIONS:
        errors.append(
            diagnostic(
                "FE-EXPORT-3",
                location,
                "Metro resolver.unstable_conditionsByPlatform drifted from Expo's "
                "expected iOS/Android/Web defaults: "
                f"{facts.get('unstable_conditionsByPlatform')!r}",
            )
        )
    return errors


def validate_internal_export(
    repo_root: Path = REPO_ROOT,
) -> tuple[str | None, list[str]]:
    path = repo_root / "apps" / "packages" / "product-client" / "package.json"
    location = display_path(path, repo_root)
    manifest = read_json(path)
    if not isinstance(manifest, dict):
        return None, [diagnostic("FE-EXPORT-4", location, "expected a JSON object")]
    exports = manifest.get("exports")
    if not isinstance(exports, dict):
        return None, [diagnostic("FE-EXPORT-4", location, "exports must be an object")]
    internal = exports.get("./internal/*")
    if not isinstance(internal, dict):
        return None, [
            diagnostic("FE-EXPORT-4", location, "exports['./internal/*'] must be an object")
        ]

    errors: list[str] = []
    unexpected = set(internal) - {"types", "default"}
    if unexpected:
        errors.append(
            diagnostic(
                "FE-EXPORT-4",
                location,
                "exports['./internal/*'] has forbidden condition overrides: "
                f"{', '.join(sorted(unexpected))}",
            )
        )
    if internal.get("types") != "./src/*":
        errors.append(
            diagnostic(
                "FE-EXPORT-4",
                location,
                "exports['./internal/*'].types must be exactly './src/*'",
            )
        )
    runtime_target = internal.get("default")
    if runtime_target != "./dist/*.js":
        errors.append(
            diagnostic(
                "FE-EXPORT-4",
                location,
                "exports['./internal/*'].default must be exactly './dist/*.js'",
            )
        )
        return None, errors
    return runtime_target, errors


def valid_domain_subpath(subpath: str) -> bool:
    if not subpath or subpath.endswith("/") or "?" in subpath or "#" in subpath or "\\" in subpath:
        return False
    return all(part not in {"", ".", ".."} for part in subpath.split("/"))


def resolve_export_target(pattern: str, subpath: str) -> str | None:
    if pattern.count("*") != 1 or not valid_domain_subpath(subpath):
        return None
    target = pattern.replace("*", subpath)
    if not target.startswith("./"):
        return None
    parts = PurePosixPath(target.removeprefix("./")).parts
    if any(part in {"", ".", ".."} for part in parts):
        return None
    if len(parts) < 3 or parts[:2] != ("dist", "domain"):
        return None
    return target


def no_mobile_edges_error() -> str:
    return diagnostic(
        "FE-EXPORT-8",
        "apps/mobile/src",
        "contains no ProductClient import; proof cannot establish a domain edge",
    )


def validate_mobile_edges(
    runtime_pattern: str,
    edges: list[MobileEdge],
    repo_root: Path = REPO_ROOT,
) -> list[str]:
    if not edges:
        return [no_mobile_edges_error()]

    product_client_root = repo_root / "apps" / "packages" / "product-client"
    errors: list[str] = []
    checked_runtime_targets: set[str] = set()
    checked_declaration_targets: set[str] = set()
    for edge in edges:
        if not edge.source.startswith(PRODUCT_CLIENT_DOMAIN_PREFIX):
            errors.append(
                edge.format(
                    "FE-EXPORT-5",
                    "Mobile may import ProductClient only through "
                    f"{PRODUCT_CLIENT_DOMAIN_PREFIX}<concrete-file>; found {edge.source!r}",
                    repo_root=repo_root,
                )
            )
            continue
        subpath = edge.source.removeprefix(PRODUCT_CLIENT_DOMAIN_PREFIX)
        runtime_target = resolve_export_target(runtime_pattern, f"domain/{subpath}")
        if runtime_target is None:
            errors.append(
                edge.format(
                    "FE-EXPORT-5",
                    f"ProductClient export does not map {edge.source!r} to a "
                    "concrete dist/domain JS file",
                    repo_root=repo_root,
                )
            )
            continue
        runtime_path = product_client_root / runtime_target.removeprefix("./")
        declaration_path = runtime_path.with_suffix(".d.ts")
        if not edge.type_only and runtime_target not in checked_runtime_targets:
            if not runtime_path.is_file():
                errors.append(
                    edge.format(
                        "FE-EXPORT-6",
                        f"missing built ProductClient runtime target {runtime_path}",
                        repo_root=repo_root,
                    )
                )
            checked_runtime_targets.add(runtime_target)
        if runtime_target not in checked_declaration_targets and not declaration_path.is_file():
            errors.append(
                edge.format(
                    "FE-EXPORT-7",
                    f"missing adjacent ProductClient declaration target {declaration_path}",
                    repo_root=repo_root,
                )
            )
        checked_declaration_targets.add(runtime_target)
    return errors


def check_preflight(
    repo_root: Path = REPO_ROOT,
    *,
    metro_facts: dict[str, Any] | None = None,
) -> list[str]:
    errors: list[str] = []
    try:
        errors.extend(validate_mobile_tsconfig(repo_root))
    except ValueError as error:
        errors.append(diagnostic("FE-EXPORT-1", "apps/mobile/tsconfig.json", str(error)))

    if metro_facts is None:
        try:
            metro_facts = load_effective_metro_facts(repo_root)
        except ValueError as error:
            errors.append(diagnostic("FE-EXPORT-3", "apps/mobile/metro.config.js", str(error)))
    if metro_facts is not None:
        errors.extend(validate_metro_facts(metro_facts))

    runtime_pattern: str | None = None
    try:
        runtime_pattern, export_errors = validate_internal_export(repo_root)
        errors.extend(export_errors)
    except ValueError as error:
        errors.append(
            diagnostic(
                "FE-EXPORT-4",
                "apps/packages/product-client/package.json",
                str(error),
            )
        )

    edges = collect_mobile_edges(repo_root)
    if runtime_pattern is not None:
        errors.extend(validate_mobile_edges(runtime_pattern, edges, repo_root))
    elif not edges:
        errors.append(no_mobile_edges_error())
    return errors


def source_with_root(source_root: str, source: str) -> str:
    if not source_root or source.startswith(("/", "file:", "http:", "https:")):
        return source
    return f"{source_root.rstrip('/')}/{source.lstrip('/')}"


def source_map_sources(value: Any) -> tuple[list[str], list[str]]:
    """Flatten a source map's `sources`, collecting shape complaints as details.

    Errors are details relative to the map, not absolute: the caller owns the
    file location it renders them against. A nested context (`sections[0].map`)
    is kept as a prefix because the offending map is not the outer one.
    """
    sources: list[str] = []
    errors: list[str] = []

    def note(context: str, detail: str) -> None:
        errors.append(f"{context}: {detail}" if context else detail)

    def visit(mapping: Any, context: str) -> None:
        if not isinstance(mapping, dict):
            note(context, "source map must be an object")
            return
        if mapping.get("version") != 3:
            note(context, "source map version must be 3")

        raw_sources = mapping.get("sources")
        sections = mapping.get("sections")
        if raw_sources is not None:
            if not isinstance(raw_sources, list) or not all(
                isinstance(source, str) for source in raw_sources
            ):
                note(context, "sources must be a list of strings")
            else:
                source_root = mapping.get("sourceRoot", "")
                if not isinstance(source_root, str):
                    note(context, "sourceRoot must be a string")
                    source_root = ""
                sources.extend(source_with_root(source_root, source) for source in raw_sources)
        elif sections is None:
            note(context, "source map has neither sources nor sections")

        if sections is not None:
            if not isinstance(sections, list):
                note(context, "sections must be a list")
                return
            for index, section in enumerate(sections):
                nested = f"{context}.sections[{index}]" if context else f"sections[{index}]"
                if not isinstance(section, dict) or "map" not in section:
                    note(nested, "missing nested map")
                    continue
                visit(section["map"], f"{nested}.map")

    visit(value, "")
    return sources, errors


PRODUCT_CLIENT_SOURCE_PATTERNS = (
    re.compile(r"(?:^|/)apps/packages/product-client/(?P<path>.*)$"),
    re.compile(r"(?:^|/)node_modules/@proliferate/product-client/(?P<path>.*)$"),
    re.compile(r"(?:^|/)@proliferate/product-client/(?P<path>.*)$"),
    re.compile(r"(?:^|/)packages/product-client/(?P<path>(?:src|dist)/.*)$"),
)


def normalize_product_client_path(path: str) -> str:
    parts: list[str] = []
    for part in path.split("/"):
        if part in {"", "."}:
            continue
        if part == "..":
            if parts and parts[-1] != "..":
                parts.pop()
            else:
                parts.append(part)
            continue
        parts.append(part)
    return "/".join(parts)


def classify_product_client_source(source: str) -> str | None:
    normalized = unquote(source).replace("\\", "/")
    normalized = normalized.split("?", 1)[0].split("#", 1)[0]
    for pattern in PRODUCT_CLIENT_SOURCE_PATTERNS:
        match = pattern.search(normalized)
        if match is not None:
            return normalize_product_client_path(match.group("path"))
    return None


def check_export_maps(export_dir: Path) -> list[str]:
    export_dir = export_dir.resolve()
    if not export_dir.is_dir():
        return [
            diagnostic(
                "FE-EXPORT-9",
                export_dir.as_posix(),
                "export directory does not exist or is not a directory",
            )
        ]
    map_paths = sorted(export_dir.rglob("*.map"))
    if not map_paths:
        return [diagnostic("FE-EXPORT-9", export_dir.as_posix(), "no emitted source maps found")]

    errors: list[str] = []
    product_client_sources = 0
    for path in map_paths:
        try:
            mapping = read_json(path)
        except ValueError as error:
            errors.append(diagnostic("FE-EXPORT-9", path.as_posix(), str(error)))
            continue
        sources, map_errors = source_map_sources(mapping)
        errors.extend(diagnostic("FE-EXPORT-9", path.as_posix(), error) for error in map_errors)
        for source in sources:
            package_path = classify_product_client_source(source)
            if package_path is None:
                continue
            product_client_sources += 1
            if not package_path.startswith(("src/domain/", "dist/domain/")):
                errors.append(
                    diagnostic(
                        "FE-EXPORT-9",
                        path.as_posix(),
                        f"forbidden ProductClient source in Mobile export: {source!r}",
                    )
                )

    if product_client_sources == 0:
        errors.append(
            diagnostic(
                "FE-EXPORT-9",
                export_dir.as_posix(),
                "emitted source maps contain no ProductClient module",
            )
        )
    return errors


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prove Mobile resolves only ProductClient's built domain graph."
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--preflight",
        action="store_true",
        help="check tsconfig, effective Metro config, package exports, imports, and built targets",
    )
    mode.add_argument(
        "--export-dir",
        type=Path,
        help="inspect source maps emitted by the bounded real Expo export",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    errors = check_preflight() if args.preflight else check_export_maps(args.export_dir)
    if errors:
        print("Mobile ProductClient export proof failed:", file=sys.stderr)
        for error in errors:
            print(error, file=sys.stderr)
            print(file=sys.stderr)
        return 1
    if args.preflight:
        print("Mobile ProductClient export preflight passed.")
    else:
        print("Mobile ProductClient export source-map proof passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
