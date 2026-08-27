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

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    # Run as `python3 scripts/check_docs.py` from the repo root, sys.path[0] is
    # scripts/ — the shared loader lives one level up.
    sys.path.insert(0, str(ROOT))

from scripts import lint_records  # noqa: E402  (path shim must precede the import)

CHECKER = "scripts/check_docs.py"
RULES = lint_records.load("product")
OWNED_RULE_IDS = frozenset(rule.id for rule in RULES.rules.values() if rule.enforced_by == CHECKER)


@dataclass(frozen=True)
class Finding:
    """One documentation violation, reported through its record."""

    rule_id: str
    location: str
    detail: str

    def format(self) -> str:
        """The record-generated diagnostic: rule, alternative, record path."""
        return lint_records.render_diagnostic(RULES.rule(self.rule_id), self.location, self.detail)


HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
SETEXT_HEADING = re.compile(r"^\s{0,3}(?:=+|-+)\s*$")
FENCE = re.compile(r"^\s{0,3}(`{3,}|~{3,})")
INLINE_CODE = re.compile(r"(`+)(.+?)\1")
REFERENCE_DEFINITION = re.compile(r"^\s{0,3}\[[^\]]+\]:\s*(.+?)\s*$")
HTML_ANCHOR = re.compile(r"<(?:a|[A-Za-z][^>]*)\s+(?:[^>]*?\s)?(?:id|name)=[\"']([^\"']+)[\"']")
EXTERNAL_PREFIXES = ("http://", "https://", "mailto:", "tel:", "data:")
ENV_VAR_CATALOG = Path("specs/areas/env-vars.yaml")
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
SPECS_ROOTS = {
    "areas",
    "systems",
    "engineering",
}
SPECS_ROOT_FILES = {
    "README.md",
    "ARCHITECTURE.md",
    "DESIGN_SYSTEM.md",
    "BUILDING.md",
    "product-sense.md",
    "authoring.md",
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
    "specs/ARCHITECTURE.md",
    "specs/DESIGN_SYSTEM.md",
    "specs/product-sense.md",
    "specs/authoring.md",
    "specs/areas/server.md",
    "specs/areas/anyharness.md",
    "specs/areas/frontend.md",
    "specs/areas/infra.md",
    "specs/systems/agent_auth/README.md",
    "specs/systems/api/README.md",
    "specs/systems/automations/README.md",
    "specs/systems/billing/README.md",
    "specs/systems/chat/README.md",
    "specs/systems/desktop-host/README.md",
    "specs/systems/environments/README.md",
    "specs/systems/github/README.md",
    "specs/systems/harnesses/README.md",
    "specs/systems/identity/README.md",
    "specs/systems/integration_gateway/README.md",
    "specs/systems/onboarding/README.md",
    "specs/systems/runs-triage/README.md",
    "specs/systems/sessions/README.md",
    "specs/systems/settings/README.md",
    "specs/systems/slack/README.md",
    "specs/systems/subagents/README.md",
    "specs/systems/support/README.md",
    "specs/systems/workspace-surface/README.md",
    "specs/systems/workspaces/README.md",
    "specs/engineering/testing/README.md",
    "specs/engineering/observability/README.md",
    "specs/engineering/ci-cd/README.md",
    "specs/engineering/security/README.md",
    "specs/engineering/customer-loop/README.md",
    "specs/engineering/testing/lints.md",
    "specs/engineering/testing/release.md",
    "specs/engineering/ci-cd/pipelines.md",
    "specs/BUILDING.md",
    "guides/deploying/manual-release-qa.md",
    "specs/engineering/observability/standard.md",
    "guides/README.md",
    "guides/process/README.md",
    "guides/local/README.md",
    "guides/debugging/README.md",
    "guides/deploying/README.md",
    "guides/operating/README.md",
    "guides/operating/analytics/README.md",
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
    return [Path(line) for line in output.splitlines() if line and (ROOT / line).exists()]


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
                findings.append(Finding("PROD-DOCS-5", location, f"missing link target {target}"))
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
                    findings.append(Finding("PROD-DOCS-8", location, f"invalid YAML: {detail}"))
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


def check_specs_roots() -> list[Finding]:
    """The specs/ tree has exactly four groups plus the five root docs."""
    prefix = Path("specs")
    unexpected: set[str] = set()
    for path in tracked_paths(str(prefix)):
        try:
            relative = path.relative_to(prefix)
        except ValueError:
            continue
        if (
            len(relative.parts) >= 2
            and relative.parts[0] not in SPECS_ROOTS
            or len(relative.parts) == 1
            and relative.parts[0] not in SPECS_ROOT_FILES
        ):
            unexpected.add(relative.parts[0])

    allowed = ", ".join(sorted(SPECS_ROOTS) + sorted(SPECS_ROOT_FILES))
    return [
        Finding(
            "PROD-DOCS-2",
            str(prefix / root),
            f"unexpected specs/ root (allowed: {allowed})",
        )
        for root in sorted(unexpected)
    ]


def main() -> int:
    findings = (
        check_routing_roots() + check_specs_roots() + check_markdown() + check_structured_data()
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
