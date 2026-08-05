#!/usr/bin/env python3
"""Prove Mobile reaches only ProductClient's built, headless domain graph."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
from typing import Any
from urllib.parse import unquote

try:
    from scripts.frontend_imports import collect_module_specifiers
except ModuleNotFoundError:  # Direct `python3 scripts/...` execution.
    from frontend_imports import collect_module_specifiers


REPO_ROOT = Path(__file__).resolve().parents[1]
PRODUCT_CLIENT_DOMAIN_PREFIX = "@proliferate/product-client/internal/domain/"
PRODUCT_CLIENT_PACKAGE = "@proliferate/product-client"

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

    def format(self, message: str, *, repo_root: Path) -> str:
        try:
            display_path = self.path.relative_to(repo_root).as_posix()
        except ValueError:
            display_path = self.path.as_posix()
        return f"{display_path}:{self.lineno}: {message}"


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


def relative_import_targets_product_client(
    path: Path, source: str, *, repo_root: Path
) -> bool:
    if not source.startswith("."):
        return False
    resolved = (path.parent / clean_module_source(source)).resolve()
    product_client_root = (
        repo_root / "apps" / "packages" / "product-client"
    ).resolve()
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
    config = read_json(path)
    if not isinstance(config, dict):
        return [f"{path}: expected a JSON object"]
    compiler_options = config.get("compilerOptions", {})
    if not isinstance(compiler_options, dict):
        return [f"{path}: compilerOptions must be an object"]

    errors: list[str] = []
    if "baseUrl" in compiler_options:
        errors.append(
            f"{path}: compilerOptions.baseUrl must be absent so Expo cannot "
            "intercept package exports"
        )
    if "paths" in compiler_options:
        errors.append(
            f"{path}: compilerOptions.paths must be absent so Expo cannot "
            "resolve ProductClient source aliases"
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
            "apps/mobile/metro.config.js probe did not return valid JSON: "
            f"{error.msg}"
        ) from error
    if not isinstance(facts, dict):
        raise ValueError("apps/mobile/metro.config.js probe returned a non-object")
    return facts


def validate_metro_facts(facts: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if facts.get("resolveRequest") is not None:
        errors.append(
            "apps/mobile/metro.config.js must not install a custom resolver.resolveRequest"
        )
    if facts.get("unstable_enablePackageExports") is not True:
        errors.append(
            "Metro resolver.unstable_enablePackageExports must be exactly true"
        )
    if facts.get("unstable_conditionNames") != []:
        errors.append("Metro resolver.unstable_conditionNames must be exactly []")
    if facts.get("unstable_conditionsByPlatform") != EXPECTED_METRO_CONDITIONS:
        errors.append(
            "Metro resolver.unstable_conditionsByPlatform drifted from Expo's expected "
            f"iOS/Android/Web defaults: {facts.get('unstable_conditionsByPlatform')!r}"
        )
    return errors


def validate_internal_export(
    repo_root: Path = REPO_ROOT,
) -> tuple[str | None, list[str]]:
    path = repo_root / "apps" / "packages" / "product-client" / "package.json"
    manifest = read_json(path)
    if not isinstance(manifest, dict):
        return None, [f"{path}: expected a JSON object"]
    exports = manifest.get("exports")
    if not isinstance(exports, dict):
        return None, [f"{path}: exports must be an object"]
    internal = exports.get("./internal/*")
    if not isinstance(internal, dict):
        return None, [f"{path}: exports['./internal/*'] must be an object"]

    errors: list[str] = []
    unexpected = set(internal) - {"types", "default"}
    if unexpected:
        errors.append(
            f"{path}: exports['./internal/*'] has forbidden condition overrides: "
            f"{', '.join(sorted(unexpected))}"
        )
    if internal.get("types") != "./src/*":
        errors.append(
            f"{path}: exports['./internal/*'].types must be exactly './src/*'"
        )
    runtime_target = internal.get("default")
    if runtime_target != "./dist/*.js":
        errors.append(
            f"{path}: exports['./internal/*'].default must be exactly './dist/*.js'"
        )
        return None, errors
    return runtime_target, errors


def valid_domain_subpath(subpath: str) -> bool:
    if (
        not subpath
        or subpath.endswith("/")
        or "?" in subpath
        or "#" in subpath
        or "\\" in subpath
    ):
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


def validate_mobile_edges(
    runtime_pattern: str,
    edges: list[MobileEdge],
    repo_root: Path = REPO_ROOT,
) -> list[str]:
    if not edges:
        return [
            "apps/mobile/src contains no ProductClient import; proof cannot "
            "establish a domain edge"
        ]

    product_client_root = repo_root / "apps" / "packages" / "product-client"
    errors: list[str] = []
    checked_runtime_targets: set[str] = set()
    checked_declaration_targets: set[str] = set()
    for edge in edges:
        if not edge.source.startswith(PRODUCT_CLIENT_DOMAIN_PREFIX):
            errors.append(
                edge.format(
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
                        f"missing built ProductClient runtime target {runtime_path}",
                        repo_root=repo_root,
                    )
                )
            checked_runtime_targets.add(runtime_target)
        if (
            runtime_target not in checked_declaration_targets
            and not declaration_path.is_file()
        ):
            errors.append(
                edge.format(
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
        errors.append(str(error))

    if metro_facts is None:
        try:
            metro_facts = load_effective_metro_facts(repo_root)
        except ValueError as error:
            errors.append(str(error))
    if metro_facts is not None:
        errors.extend(validate_metro_facts(metro_facts))

    runtime_pattern: str | None = None
    try:
        runtime_pattern, export_errors = validate_internal_export(repo_root)
        errors.extend(export_errors)
    except ValueError as error:
        errors.append(str(error))

    edges = collect_mobile_edges(repo_root)
    if runtime_pattern is not None:
        errors.extend(validate_mobile_edges(runtime_pattern, edges, repo_root))
    elif not edges:
        errors.append(
            "apps/mobile/src contains no ProductClient import; proof cannot "
            "establish a domain edge"
        )
    return errors


def source_with_root(source_root: str, source: str) -> str:
    if not source_root or source.startswith(("/", "file:", "http:", "https:")):
        return source
    return f"{source_root.rstrip('/')}/{source.lstrip('/')}"


def source_map_sources(
    value: Any, *, label: str
) -> tuple[list[str], list[str]]:
    sources: list[str] = []
    errors: list[str] = []

    def visit(mapping: Any, context: str) -> None:
        if not isinstance(mapping, dict):
            errors.append(f"{context}: source map must be an object")
            return
        if mapping.get("version") != 3:
            errors.append(f"{context}: source map version must be 3")

        raw_sources = mapping.get("sources")
        sections = mapping.get("sections")
        if raw_sources is not None:
            if not isinstance(raw_sources, list) or not all(
                isinstance(source, str) for source in raw_sources
            ):
                errors.append(f"{context}: sources must be a list of strings")
            else:
                source_root = mapping.get("sourceRoot", "")
                if not isinstance(source_root, str):
                    errors.append(f"{context}: sourceRoot must be a string")
                    source_root = ""
                sources.extend(
                    source_with_root(source_root, source) for source in raw_sources
                )
        elif sections is None:
            errors.append(f"{context}: source map has neither sources nor sections")

        if sections is not None:
            if not isinstance(sections, list):
                errors.append(f"{context}: sections must be a list")
                return
            for index, section in enumerate(sections):
                if not isinstance(section, dict) or "map" not in section:
                    errors.append(f"{context}.sections[{index}]: missing nested map")
                    continue
                visit(section["map"], f"{context}.sections[{index}].map")

    visit(value, label)
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
        return [f"export directory does not exist or is not a directory: {export_dir}"]
    map_paths = sorted(export_dir.rglob("*.map"))
    if not map_paths:
        return [f"{export_dir}: no emitted source maps found"]

    errors: list[str] = []
    product_client_sources = 0
    for path in map_paths:
        try:
            mapping = read_json(path)
        except ValueError as error:
            errors.append(str(error))
            continue
        sources, map_errors = source_map_sources(mapping, label=path.as_posix())
        errors.extend(map_errors)
        for source in sources:
            package_path = classify_product_client_source(source)
            if package_path is None:
                continue
            product_client_sources += 1
            if not package_path.startswith(("src/domain/", "dist/domain/")):
                errors.append(
                    f"{path}: forbidden ProductClient source in Mobile export: {source!r}"
                )

    if product_client_sources == 0:
        errors.append(
            f"{export_dir}: emitted source maps contain no ProductClient module"
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
            print(f"  {error}", file=sys.stderr)
        return 1
    if args.preflight:
        print("Mobile ProductClient export preflight passed.")
    else:
        print("Mobile ProductClient export source-map proof passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
