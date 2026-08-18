#!/usr/bin/env python3
"""Validate repository documentation without network access.

The rules themselves are records under `lints/product/docs.toml`; this file is
only the engine. Diagnostics are rendered from the record (rule sentence, legal
alternative, record path) via `scripts/lint_records.py`, so a failure always says
what to do instead of naming a violated string.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import unicodedata
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote


MINIMUM_PYTHON = (3, 12)


def python_version_diagnostic(version: tuple[int, ...]) -> str | None:
    """Return the one-line interpreter remediation, if the version is too old."""
    if version[:2] >= MINIMUM_PYTHON:
        return None
    found = ".".join(str(part) for part in version[:3])
    return (
        "scripts/check_docs.py requires Python 3.12 or newer "
        f"(found {found}); rerun with a Python 3.12 interpreter."
    )


_VERSION_DIAGNOSTIC = python_version_diagnostic(tuple(sys.version_info))
if _VERSION_DIAGNOSTIC is not None:
    print(_VERSION_DIAGNOSTIC, file=sys.stderr)
    raise SystemExit(2)


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    # Run as `python3 scripts/check_docs.py` from the repo root, sys.path[0] is
    # scripts/ — the shared loader lives one level up.
    sys.path.insert(0, str(ROOT))

from scripts import lint_records  # noqa: E402  (path shim must precede the import)

CHECKER = "scripts/check_docs.py"
RULES = lint_records.load("product")
OWNED_RULE_IDS = frozenset(
    rule.id for rule in RULES.rules.values() if rule.enforced_by == CHECKER
)


@dataclass(frozen=True)
class Finding:
    """One documentation violation, reported through its record."""

    rule_id: str
    location: str
    detail: str

    def format(self) -> str:
        """The record-generated diagnostic: rule, alternative, record path."""
        return lint_records.render_diagnostic(
            RULES.rule(self.rule_id), self.location, self.detail
        )



HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
SETEXT_HEADING = re.compile(r"^\s{0,3}(?:=+|-+)\s*$")
FENCE = re.compile(r"^\s{0,3}(`{3,}|~{3,})")
INLINE_CODE = re.compile(r"(`+)(.+?)\1")
REFERENCE_DEFINITION = re.compile(r"^\s{0,3}\[[^\]]+\]:\s*(.+?)\s*$")
HTML_ANCHOR = re.compile(r"<(?:a|[A-Za-z][^>]*)\s+(?:[^>]*?\s)?(?:id|name)=[\"']([^\"']+)[\"']")
EXTERNAL_PREFIXES = ("http://", "https://", "mailto:", "tel:", "data:")
ENV_VAR_CATALOG = Path("specs/developing/reference/env-vars.yaml")
ENV_VAR_FIELDS = {"name", "secret", "default", "description", "tags"}
ENV_VAR_NAME = re.compile(r"^[A-Z][A-Z0-9_]*$")
ENV_VAR_TAGS = {
    "ci",
    "desktop",
    "local-dev",
    "mobile",
    "production",
    "self-hosted",
    "web",
}
DEVELOPING_ROOTS = {
    "process",
    "local",
    "testing",
    "debugging",
    "deploying",
    "operating",
    "reference",
}
SAFE_YAML_TO_JSON = r"""
require "yaml"
require "json"

file = ARGV.fetch(0)
data = YAML.safe_load(
  File.read(file),
  permitted_classes: [],
  permitted_symbols: [],
  aliases: false,
)
STDOUT.write(JSON.generate(data))
"""
REQUIRED_READMES = (
    "specs/README.md",
    "specs/codebase/README.md",
    "specs/codebase/structures/README.md",
    "specs/codebase/platforms/README.md",
    "specs/codebase/platforms/product/README.md",
    "specs/codebase/platforms/product/agent-features/README.md",
    "specs/codebase/platforms/product/agent-features/definitions/README.md",
    "specs/codebase/systems/README.md",
    "specs/codebase/systems/product/README.md",
    "specs/codebase/systems/product/agents/README.md",
    "specs/codebase/systems/product/auth/README.md",
    "specs/codebase/systems/product/chat/README.md",
    "specs/codebase/systems/product/clients/README.md",
    "specs/codebase/systems/product/clients/web-desktop-unification/README.md",
    "specs/codebase/systems/product/clients/web-desktop-unification/migration/README.md",
    "specs/codebase/systems/product/engagement/README.md",
    "specs/codebase/systems/product/onboarding/README.md",
    "specs/codebase/systems/product/organizations/README.md",
    "specs/codebase/systems/product/settings/README.md",
    "specs/codebase/systems/product/support/README.md",
    "specs/codebase/systems/product/workflows/README.md",
    "specs/codebase/systems/product/workspaces/README.md",
    "specs/codebase/systems/engineering/README.md",
    "specs/codebase/systems/engineering/analytics/README.md",
    "specs/codebase/systems/engineering/delivery/README.md",
    "specs/codebase/systems/engineering/issue-lifecycle/README.md",
    "specs/codebase/systems/engineering/observability/README.md",
    "guides/README.md",
    "guides/process/README.md",
    "guides/local/README.md",
    "specs/TESTING.md",
    "guides/debugging/README.md",
    "guides/deploying/README.md",
    "guides/operating/README.md",
    "guides/operating/analytics/README.md",
    "specs/TESTING/manual-release-qa.md",
    "specs/developing/reference/README.md",
    "specs/anyharness/README.md",
    "specs/GENERATED/README.md",
)
ROUTER_SECTIONS = ("Source router", "Cross-plane systems")
ENTRY_PAGES = (
    "README.md",
    "CONTRIBUTING.md",
    "specs/README.md",
    "ARCHITECTURE.md",
    "CLAUDE.md",
)
SOURCE_MAP_HEADING = re.compile(
    r"^(?:source|source-area|code|task)(?: area)? (?:router|routing|map)$",
    re.IGNORECASE,
)
SOURCE_MAP_TABLE = re.compile(
    r"^\s*\|[^\n]*\bsource area\b[^\n]*\bstart here\b[^\n]*\|\s*$",
    re.IGNORECASE | re.MULTILINE,
)


def tracked_files(*patterns: str) -> list[Path]:
    command = [
        "git",
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "--",
        *patterns,
    ]
    output = subprocess.run(
        command,
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return [ROOT / line for line in output.splitlines() if line and (ROOT / line).is_file()]


def tracked_paths(*patterns: str) -> list[Path]:
    """Return repository-relative tracked paths that exist in the worktree."""
    command = ["git", "ls-files", "--cached", "--", *patterns]
    output = subprocess.run(
        command,
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return [
        Path(line)
        for line in output.splitlines()
        if line and (ROOT / line).exists()
    ]


def visible_markdown_lines(text: str):
    """Yield non-fenced Markdown lines with one-based line numbers."""
    fence: str | None = None
    minimum_length = 0

    for line_number, line in enumerate(text.splitlines(), start=1):
        match = FENCE.match(line)
        if match:
            marker = match.group(1)
            if fence is None:
                fence = marker[0]
                minimum_length = len(marker)
            elif marker[0] == fence and len(marker) >= minimum_length:
                fence = None
                minimum_length = 0
            continue
        if fence is None:
            yield line_number, line


def mask_inline_code(line: str) -> str:
    return INLINE_CODE.sub(lambda match: " " * len(match.group(0)), line)


def inline_link_targets(line: str):
    """Yield destinations from inline links, balancing nested parentheses."""
    line = mask_inline_code(line)
    cursor = 0

    while True:
        opening = line.find("](", cursor)
        if opening < 0:
            return
        if line.rfind("[", 0, opening) < 0:
            cursor = opening + 2
            continue

        start = opening + 2
        depth = 1
        index = start
        while index < len(line):
            char = line[index]
            if char == "\\":
                index += 2
                continue
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
                if depth == 0:
                    yield line[start:index]
                    cursor = index + 1
                    break
            index += 1
        else:
            return


def markdown_targets(text: str):
    """Yield line number and destination for inline and reference definitions."""
    for line_number, line in visible_markdown_lines(text):
        visible_line = mask_inline_code(line)
        definition = REFERENCE_DEFINITION.match(visible_line)
        if definition:
            yield line_number, definition.group(1)
        for target in inline_link_targets(visible_line):
            yield line_number, target


def markdown_section(text: str, heading: str) -> list[tuple[int, str]]:
    """Return visible lines beneath one exact level-two heading."""
    lines = list(visible_markdown_lines(text))
    start: int | None = None
    section: list[tuple[int, str]] = []
    for line_number, line in lines:
        match = HEADING.match(line)
        if match and len(match.group(1)) == 2:
            if start is not None:
                break
            if match.group(2).strip().casefold() == heading.casefold():
                start = line_number
            continue
        if start is not None:
            section.append((line_number, line))
    return section


def router_targets(text: str) -> list[tuple[str, int, str]]:
    """Derive canonical local links from AGENTS.md's two routing tables."""
    targets: list[tuple[str, int, str]] = []
    for section_name in ROUTER_SECTIONS:
        for line_number, line in markdown_section(text, section_name):
            if not line.lstrip().startswith("|"):
                continue
            for raw_target in inline_link_targets(line):
                target = unquote(normalized_target(raw_target))
                path_text = target.partition("#")[0]
                if path_text and not path_text.startswith(EXTERNAL_PREFIXES):
                    targets.append((section_name, line_number, path_text))
    return targets


def resolve_router_target(root: Path, raw_target: str) -> list[Path]:
    """Resolve a canonical route, using a directory's landing documents."""
    target = (root / raw_target).resolve()
    try:
        target.relative_to(root.resolve())
    except ValueError:
        return []
    if not target.is_dir():
        return [target] if target.is_file() else []

    readme = target / "README.md"
    if readme.is_file():
        return [readme]

    # A few established feature families deliberately fence several peer
    # owner documents without a second index. Validate every immediate owner
    # instead of silently exempting the directory route.
    return sorted(path for path in target.glob("*.md") if path.is_file())


def document_authority(text: str) -> str:
    """Classify the explicit authority marker in a document preamble."""
    preamble: list[str] = []
    for _, line in visible_markdown_lines(text):
        if line.startswith("## "):
            break
        preamble.append(line)
    header = "\n".join(preamble)
    if re.search(r"(?im)^\s*(?:>\s*)?(?:\*\*)?SUPERSEDED\b", header) or re.search(
        r"(?im)^\s*Status:\s*superseded\b", header
    ):
        return "superseded"
    if re.search(r"(?im)^\s*Status:\s*target\b", header):
        return "target"
    return "current"


def exposes_current_gaps(text: str) -> bool:
    """Whether a target document exposes its observed-current delta."""
    for _, line in visible_markdown_lines(text):
        match = HEADING.match(line)
        if match and re.search(
            r"\b(?:current gaps?|implementation status)\b",
            match.group(2),
            re.IGNORECASE,
        ):
            return True
    return bool(re.search(r"\[Current gaps?\]\([^)]*\)", text, re.IGNORECASE))


def check_canonical_routes() -> list[Finding]:
    """Enforce authority/status semantics on routes derived from AGENTS.md."""
    agents = ROOT / "AGENTS.md"
    if not agents.is_file():
        return [Finding("PROD-DOCS-10", "AGENTS.md", "canonical router is missing")]

    findings: list[Finding] = []
    targets = router_targets(agents.read_text(encoding="utf-8"))
    for section_name in ROUTER_SECTIONS:
        if not any(target[0] == section_name for target in targets):
            findings.append(
                Finding(
                    "PROD-DOCS-10",
                    "AGENTS.md",
                    f'{section_name!r} section/table is missing or has no local owner route',
                )
            )

    for section_name, line_number, raw_target in targets:
        resolved_targets = resolve_router_target(ROOT, raw_target)
        if not resolved_targets:
            findings.append(
                Finding(
                    "PROD-DOCS-10",
                    f"AGENTS.md:{line_number}",
                    f"canonical route {raw_target!r} resolves to no landing owner",
                )
            )
            continue

        for target in resolved_targets:
            text = target.read_text(encoding="utf-8")
            authority = document_authority(text)
            location = f"AGENTS.md:{line_number} -> {target.relative_to(ROOT)}"
            if authority == "superseded":
                findings.append(
                    Finding(
                        "PROD-DOCS-10",
                        location,
                        "canonical route resolves to a superseded document",
                    )
                )
            elif authority == "target" and not exposes_current_gaps(text):
                findings.append(
                    Finding(
                        "PROD-DOCS-10",
                        location,
                        f"target route from {section_name} does not expose current gaps",
                    )
                )
    return findings


def has_competing_source_map(text: str) -> bool:
    """Detect a second source-area router on an entry page."""
    for _, line in visible_markdown_lines(text):
        match = HEADING.match(line)
        if match and SOURCE_MAP_HEADING.fullmatch(match.group(2).strip()):
            return True
    visible_text = "\n".join(line for _, line in visible_markdown_lines(text))
    return SOURCE_MAP_TABLE.search(visible_text) is not None


def defers_to_agents(relative_path: str, text: str, root: Path) -> bool:
    """Whether an entry page contains an actual local link to root AGENTS.md."""
    source = root / relative_path
    expected = (root / "AGENTS.md").resolve()
    for _, raw_target in markdown_targets(text):
        target = unquote(normalized_target(raw_target)).partition("#")[0]
        if not target or target.startswith(EXTERNAL_PREFIXES):
            continue
        if (source.parent / target).resolve() == expected:
            return True
    return False


def check_entry_page_deference() -> list[Finding]:
    """Keep source routing in AGENTS.md and the tracked harness shim thin."""
    findings: list[Finding] = []
    tracked_claude = Path("CLAUDE.md") in tracked_paths("CLAUDE.md")
    for relative_path in ENTRY_PAGES:
        path = ROOT / relative_path
        rule_id = (
            "PROD-DOCS-12" if relative_path == "CLAUDE.md" else "PROD-DOCS-11"
        )
        if not path.is_file():
            findings.append(Finding(rule_id, relative_path, "entry page is missing"))
            continue
        if relative_path == "CLAUDE.md" and not tracked_claude:
            findings.append(
                Finding(rule_id, relative_path, "harness loader is not tracked")
            )
            continue

        text = path.read_text(encoding="utf-8")
        if not defers_to_agents(relative_path, text, ROOT):
            findings.append(
                Finding(rule_id, relative_path, "entry page does not link to AGENTS.md")
            )
        if has_competing_source_map(text):
            findings.append(
                Finding(rule_id, relative_path, "entry page defines a competing source map")
            )
    return findings


def github_slug(value: str) -> str:
    value = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", value)
    value = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", value)
    value = re.sub(r"<[^>]+>", "", value)
    value = value.replace("`", "").strip().lower()
    value = "".join(
        char
        for char in value
        if char in "-_ " or char.isalnum() or unicodedata.category(char).startswith("L")
    )
    return re.sub(r"\s", "-", value)


def anchors_for(path: Path) -> set[str]:
    anchors: set[str] = set()
    counts: Counter[str] = Counter()
    previous_line: str | None = None

    def add_heading(value: str) -> None:
        base = github_slug(value)
        if not base:
            return
        suffix = counts[base]
        counts[base] += 1
        anchors.add(base if suffix == 0 else f"{base}-{suffix}")

    text = path.read_text(encoding="utf-8")
    for _, line in visible_markdown_lines(text):
        for explicit in HTML_ANCHOR.findall(line):
            anchors.add(explicit)

        match = HEADING.match(line)
        if match:
            add_heading(match.group(2))
            previous_line = None
            continue

        if SETEXT_HEADING.match(line) and previous_line:
            add_heading(previous_line)
            previous_line = None
            continue

        previous_line = line if line.strip() else None

    return anchors


def normalized_target(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("<") and ">" in raw:
        return raw[1 : raw.index(">")]
    # Markdown titles follow the destination after whitespace.
    return raw.split(maxsplit=1)[0]


def check_markdown() -> list[Finding]:
    findings: list[Finding] = []
    anchor_cache: dict[Path, set[str]] = {}

    for source in tracked_files("*.md", "**/*.md"):
        text = source.read_text(encoding="utf-8")
        for line_number, raw_target in markdown_targets(text):
            target = unquote(normalized_target(raw_target))
            if not target or target.startswith(EXTERNAL_PREFIXES):
                continue

            location = f"{source.relative_to(ROOT)}:{line_number}"
            path_text, separator, fragment = target.partition("#")
            if path_text.startswith("/"):
                findings.append(
                    Finding("PROD-DOCS-3", location, f"absolute repository link {target}")
                )
                continue

            destination = source if not path_text else (source.parent / path_text).resolve()
            try:
                destination.relative_to(ROOT)
            except ValueError:
                findings.append(
                    Finding("PROD-DOCS-4", location, f"link leaves the repository: {target}")
                )
                continue

            if not destination.exists():
                findings.append(
                    Finding("PROD-DOCS-5", location, f"missing link target {target}")
                )
                continue

            if not separator or not fragment or destination.suffix.lower() != ".md":
                continue
            if destination not in anchor_cache:
                anchor_cache[destination] = anchors_for(destination)
            if fragment not in anchor_cache[destination]:
                findings.append(
                    Finding("PROD-DOCS-6", location, f"missing heading anchor {target}")
                )

    return findings


def validate_env_var_catalog(data: object) -> list[str]:
    """Validate the curated environment-variable catalog schema."""
    if not isinstance(data, list):
        return ["environment variable catalog must be a top-level list"]

    errors: list[str] = []
    names: set[str] = set()
    for index, entry in enumerate(data, start=1):
        location = f"environment variable catalog entry {index}"
        if not isinstance(entry, dict):
            errors.append(f"{location} must be an object")
            continue

        fields = set(entry)
        missing = sorted(ENV_VAR_FIELDS - fields)
        unknown = sorted(fields - ENV_VAR_FIELDS)
        if missing:
            errors.append(f"{location} is missing fields: {', '.join(missing)}")
        if unknown:
            errors.append(f"{location} has unknown fields: {', '.join(unknown)}")

        name = entry.get("name")
        if not isinstance(name, str) or ENV_VAR_NAME.fullmatch(name) is None:
            errors.append(f"{location} has invalid name")
        elif name in names:
            errors.append(f"{location} has duplicate name: {name}")
        else:
            names.add(name)

        if type(entry.get("secret")) is not bool:
            errors.append(f"{location} secret must be a Boolean")
        if not isinstance(entry.get("default"), str):
            errors.append(f"{location} default must be a string")

        description = entry.get("description")
        if not isinstance(description, str) or not description.strip():
            errors.append(f"{location} description must be a nonempty string")

        tags = entry.get("tags")
        if not isinstance(tags, list) or not tags:
            errors.append(f"{location} tags must be a nonempty list")
            continue
        seen_tags: set[str] = set()
        for tag in tags:
            if not isinstance(tag, str) or tag not in ENV_VAR_TAGS:
                errors.append(f"{location} has unknown tag: {tag!r}")
            elif tag in seen_tags:
                errors.append(f"{location} has duplicate tag: {tag}")
            else:
                seen_tags.add(tag)

    return errors


def check_structured_data() -> list[Finding]:
    findings: list[Finding] = []

    for path in tracked_files("specs/**/*.json"):
        try:
            json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            findings.append(
                Finding("PROD-DOCS-7", str(path.relative_to(ROOT)), f"invalid JSON: {error}")
            )

    yaml_files = tracked_files("specs/**/*.yaml", "specs/**/*.yml")
    if yaml_files:
        ruby = shutil.which("ruby")
        if ruby is None:
            findings.append(
                Finding(
                    "PROD-DOCS-8",
                    "specs/**/*.yaml",
                    "Ruby is required to parse checked-in YAML documentation",
                )
            )
        else:
            for path in yaml_files:
                location = str(path.relative_to(ROOT))
                command = [ruby, "-e", SAFE_YAML_TO_JSON, str(path)]
                result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
                if result.returncode:
                    detail = (result.stderr or result.stdout).strip()
                    findings.append(
                        Finding("PROD-DOCS-8", location, f"invalid YAML: {detail}")
                    )
                    continue

                try:
                    data = json.loads(result.stdout)
                except json.JSONDecodeError as error:
                    findings.append(
                        Finding(
                            "PROD-DOCS-8",
                            location,
                            f"invalid YAML JSON output: {error}",
                        )
                    )
                    continue

                if path.relative_to(ROOT) == ENV_VAR_CATALOG:
                    findings.extend(
                        Finding("PROD-DOCS-9", str(ENV_VAR_CATALOG), error)
                        for error in validate_env_var_catalog(data)
                    )

    return findings


def check_routing_roots() -> list[Finding]:
    return [
        Finding("PROD-DOCS-1", path, "missing documentation routing root")
        for path in REQUIRED_READMES
        if not (ROOT / path).is_file()
    ]


def check_developing_roots() -> list[Finding]:
    prefix = Path("specs/developing")
    unexpected: set[str] = set()
    for path in tracked_paths(str(prefix)):
        try:
            relative = path.relative_to(prefix)
        except ValueError:
            continue
        if len(relative.parts) >= 2 and relative.parts[0] not in DEVELOPING_ROOTS:
            unexpected.add(relative.parts[0])

    allowed = ", ".join(sorted(DEVELOPING_ROOTS))
    return [
        Finding(
            "PROD-DOCS-2",
            str(prefix / root),
            f"unexpected Developing documentation root (allowed roots: {allowed})",
        )
        for root in sorted(unexpected)
    ]


def main() -> int:
    findings = (
        check_routing_roots()
        + check_developing_roots()
        + check_canonical_routes()
        + check_entry_page_deference()
        + check_markdown()
        + check_structured_data()
    )
    if findings:
        print("Documentation integrity check failed:", file=sys.stderr)
        for finding in findings:
            print(finding.format(), file=sys.stderr)
            print(file=sys.stderr)
        return 1

    markdown_count = len(tracked_files("*.md", "**/*.md"))
    print(f"Documentation integrity check passed ({markdown_count} Markdown files).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
