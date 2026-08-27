#!/usr/bin/env python3
"""Enforce the lane census recorded as PROD-LANE-001/002/003.

The census law (ruled 2026-08-26): every CI job belongs to exactly one
pipeline, and every pipeline has an honest trigger — a dispatch-only lane
doesn't exist. ``lints/product/lanes.toml`` holds one ``[[lane]]`` row per
workflow job and one ``[[quarantine]]`` row per sanctioned
``continue-on-error`` site; this checker diffs both against the workflows in
both directions, exactly like every other baseline in the constitution.

The workflow parser is deliberately minimal (stdlib only, like every engine
here): it extracts top-level trigger keys, job ids, and ``continue-on-error``
occurrences from the repository's consistently-formatted workflow files, and
raises loudly on any shape it cannot parse. Full YAML syntax remains the
CI/CD-config job's ruby parse; this engine only reads the three facts the
census needs.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import re
import sys
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts import lint_records  # noqa: E402 - repo-root bootstrap above

WORKFLOWS_ROOT = REPO_ROOT / ".github" / "workflows"
LANES_SOURCE = "lints/product/lanes.toml"

CENSUS_RULE_ID = "PROD-LANE-001"
CADENCE_RULE_ID = "PROD-LANE-002"
QUARANTINE_RULE_ID = "PROD-LANE-003"

PIPELINES = (
    "pr",
    "main",
    "nightly",
    "release",
    "prod",
    "dispatch-with-sunset",
    "reusable",
)

# The honest-trigger contract per pipeline: the workflow's top-level triggers
# must intersect the named set (empty tuple = no trigger requirement beyond
# the sunset-date rule below).
REQUIRED_TRIGGERS = {
    "pr": ("pull_request", "pull_request_target"),
    "main": ("push", "workflow_run"),
    "nightly": ("schedule",),
    "release": ("push", "workflow_dispatch", "workflow_call"),
    "prod": ("schedule", "workflow_dispatch"),
    "dispatch-with-sunset": (),
    "reusable": ("workflow_call",),
}

_TOP_KEY_RE = re.compile(r"^([A-Za-z_-]+):")
_TRIGGER_RE = re.compile(r"^  ([a-z_]+):")
_JOB_RE = re.compile(r"^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@dataclass(frozen=True)
class WorkflowFacts:
    name: str  # basename, e.g. "ci.yml"
    triggers: tuple[str, ...]
    jobs: tuple[str, ...]
    # (job id, line number) per continue-on-error occurrence, job- or step-level
    continue_on_error: tuple[tuple[str, int], ...]


@dataclass(frozen=True)
class LaneRow:
    workflow: str
    job: str
    pipeline: str
    cadence: str
    gate_mirrored: bool
    sunset: str = ""
    note: str = ""


@dataclass(frozen=True)
class QuarantineRow:
    workflow: str
    job: str
    owner: str
    reason: str
    expires: str


@dataclass
class Census:
    lanes: dict[tuple[str, str], LaneRow] = field(default_factory=dict)
    quarantine: dict[tuple[str, str], QuarantineRow] = field(default_factory=dict)


def parse_workflow(path: Path) -> WorkflowFacts:
    """Extract triggers, job ids, and continue-on-error sites from one file."""
    triggers: list[str] = []
    jobs: list[str] = []
    continue_on_error: list[tuple[str, int]] = []
    section = ""
    current_job = ""
    saw_on = False
    saw_jobs = False

    for index, raw in enumerate(path.read_text(encoding="utf-8").split("\n"), start=1):
        line = raw.rstrip()
        if "\t" in line:
            raise ValueError(f"{path.name}:{index}: tab indentation is unparseable here")
        stripped = line.strip()
        top = _TOP_KEY_RE.match(line)
        if top:
            if saw_jobs:
                # Anything after `jobs:` would silently end job parsing and
                # under-count the census — refuse rather than guess.
                raise ValueError(
                    f"{path.name}:{index}: top-level `{top.group(1)}:` after `jobs:` "
                    "is unsupported — keep `jobs:` last"
                )
            section = top.group(1)
            if section == "on":
                saw_on = True
                if stripped != "on:":
                    raise ValueError(
                        f"{path.name}:{index}: inline `on:` value is unparseable — "
                        "use the block form"
                    )
            if section == "jobs":
                saw_jobs = True
            continue
        if not stripped or stripped.startswith("#"):
            continue
        if section == "on":
            trigger = _TRIGGER_RE.match(line)
            if trigger:
                triggers.append(trigger.group(1))
        elif section == "jobs":
            job = _JOB_RE.match(line)
            if job:
                current_job = job.group(1)
                jobs.append(current_job)
            elif stripped.startswith("continue-on-error:"):
                if not current_job:
                    raise ValueError(
                        f"{path.name}:{index}: continue-on-error before any job id"
                    )
                continue_on_error.append((current_job, index))

    if not saw_on or not saw_jobs:
        raise ValueError(f"{path.name}: expected top-level `on:` and `jobs:` blocks")
    if not jobs:
        raise ValueError(f"{path.name}: no job ids parsed under `jobs:`")
    return WorkflowFacts(
        name=path.name,
        triggers=tuple(triggers),
        jobs=tuple(jobs),
        continue_on_error=tuple(continue_on_error),
    )


def parse_workflows(root: Path | None = None) -> list[WorkflowFacts]:
    directory = root if root is not None else WORKFLOWS_ROOT
    facts = []
    for path in sorted(directory.glob("*.yml")) + sorted(directory.glob("*.yaml")):
        facts.append(parse_workflow(path))
    if not facts:
        raise ValueError(f"{directory}: no workflow files found")
    return facts


def load_census(source: Path | None = None) -> Census:
    path = source if source is not None else REPO_ROOT / LANES_SOURCE
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    census = Census()
    for raw in data.get("lane", []):
        missing = [
            key
            for key in ("workflow", "job", "pipeline", "cadence", "gate_mirrored")
            if key not in raw
        ]
        if missing:
            raise ValueError(
                f"{LANES_SOURCE}: [[lane]] missing fields {', '.join(missing)}: {raw}"
            )
        row = LaneRow(
            workflow=raw["workflow"],
            job=raw["job"],
            pipeline=raw["pipeline"],
            cadence=raw["cadence"],
            gate_mirrored=raw["gate_mirrored"],
            sunset=raw.get("sunset", ""),
            note=raw.get("note", ""),
        )
        key = (row.workflow, row.job)
        if key in census.lanes:
            raise ValueError(f"{LANES_SOURCE}: duplicate [[lane]] row for {key}")
        if row.pipeline not in PIPELINES:
            raise ValueError(
                f"{LANES_SOURCE}: {row.workflow}:{row.job}: unknown pipeline "
                f"{row.pipeline!r} (expected one of {', '.join(PIPELINES)})"
            )
        if not isinstance(row.gate_mirrored, bool):
            raise ValueError(
                f"{LANES_SOURCE}: {row.workflow}:{row.job}: gate_mirrored must be a bool"
            )
        census.lanes[key] = row
    for raw in data.get("quarantine", []):
        missing = [
            key for key in ("workflow", "job", "owner", "reason", "expires") if key not in raw
        ]
        if missing:
            raise ValueError(
                f"{LANES_SOURCE}: [[quarantine]] missing fields {', '.join(missing)}: {raw}"
            )
        row = QuarantineRow(
            workflow=raw["workflow"],
            job=raw["job"],
            owner=raw["owner"],
            reason=raw["reason"],
            expires=raw["expires"],
        )
        key = (row.workflow, row.job)
        if key in census.quarantine:
            raise ValueError(f"{LANES_SOURCE}: duplicate [[quarantine]] row for {key}")
        census.quarantine[key] = row
    return census


def _valid_date(value: str) -> _dt.date | None:
    if not _DATE_RE.match(value):
        return None
    try:
        return _dt.date.fromisoformat(value)
    except ValueError:
        return None


def collect_violations(
    facts: list[WorkflowFacts],
    census: Census,
    today: _dt.date | None = None,
) -> list[tuple[str, str, str]]:
    """(rule id, site, detail) triples, in a stable order."""
    today = today if today is not None else _dt.date.today()
    violations: list[tuple[str, str, str]] = []
    facts_by_name = {f.name: f for f in facts}

    # Direction 1: every job has a row; rows are honest.
    for f in facts:
        workflow = f".github/workflows/{f.name}"
        for job in f.jobs:
            row = census.lanes.get((f.name, job))
            if row is None:
                violations.append(
                    (
                        CENSUS_RULE_ID,
                        f"{workflow}:{job}",
                        f"job has no [[lane]] row in {LANES_SOURCE}",
                    )
                )
                continue
            required = REQUIRED_TRIGGERS[row.pipeline]
            if required and not set(required) & set(f.triggers):
                violations.append(
                    (
                        CADENCE_RULE_ID,
                        f"{workflow}:{job}",
                        f"pipeline {row.pipeline!r} claims a trigger in "
                        f"{{{', '.join(required)}}} but the workflow's triggers are "
                        f"{{{', '.join(f.triggers)}}}",
                    )
                )
            if row.pipeline == "dispatch-with-sunset":
                sunset = _valid_date(row.sunset)
                if sunset is None:
                    violations.append(
                        (
                            CADENCE_RULE_ID,
                            f"{workflow}:{job}",
                            "dispatch-with-sunset requires sunset = \"YYYY-MM-DD\"",
                        )
                    )
                elif sunset < today:
                    violations.append(
                        (
                            CADENCE_RULE_ID,
                            f"{workflow}:{job}",
                            f"sunset {row.sunset} has passed — rule the lane "
                            "(promote its cadence or delete it)",
                        )
                    )
            elif (
                set(f.triggers) == {"workflow_dispatch"}
                and row.pipeline not in ("release", "prod")
            ):
                violations.append(
                    (
                        CADENCE_RULE_ID,
                        f"{workflow}:{job}",
                        f"workflow is dispatch-only but pipeline is {row.pipeline!r} — "
                        "a dispatch-only lane needs dispatch-with-sunset (or an event "
                        "cadence: release/prod)",
                    )
                )

    # Direction 2: no row outlives reality.
    for (workflow_name, job), row in sorted(census.lanes.items()):
        f = facts_by_name.get(workflow_name)
        if f is None or job not in f.jobs:
            violations.append(
                (
                    CENSUS_RULE_ID,
                    f"{LANES_SOURCE}:{workflow_name}:{job}",
                    "stale [[lane]] row — the workflow job no longer exists",
                )
            )

    # continue-on-error: only under an unexpired quarantine row.
    quarantined_seen: set[tuple[str, str]] = set()
    for f in facts:
        workflow = f".github/workflows/{f.name}"
        for job, line in f.continue_on_error:
            row = census.quarantine.get((f.name, job))
            if row is None:
                violations.append(
                    (
                        QUARANTINE_RULE_ID,
                        f"{workflow}:{job} (line {line})",
                        f"continue-on-error with no [[quarantine]] row in {LANES_SOURCE}",
                    )
                )
                continue
            quarantined_seen.add((f.name, job))
            expires = _valid_date(row.expires)
            if expires is None:
                violations.append(
                    (
                        QUARANTINE_RULE_ID,
                        f"{workflow}:{job} (line {line})",
                        "quarantine row needs expires = \"YYYY-MM-DD\"",
                    )
                )
            elif expires < today:
                violations.append(
                    (
                        QUARANTINE_RULE_ID,
                        f"{workflow}:{job} (line {line})",
                        f"quarantine expired {row.expires} (owner: {row.owner}) — "
                        "fix the flake or re-rule the row",
                    )
                )
    for (workflow_name, job), row in sorted(census.quarantine.items()):
        f = facts_by_name.get(workflow_name)
        alive = f is not None and any(j == job for j, _ in f.continue_on_error)
        if not alive:
            violations.append(
                (
                    QUARANTINE_RULE_ID,
                    f"{LANES_SOURCE}:{workflow_name}:{job}",
                    "stale [[quarantine]] row — no continue-on-error remains at that job",
                )
            )
    return violations


def print_missing(facts: list[WorkflowFacts], census: Census) -> None:
    """Emit [[lane]] stubs for uncensused jobs (the re-measure helper)."""
    for f in facts:
        for job in f.jobs:
            if (f.name, job) not in census.lanes:
                print("[[lane]]")
                print(f'workflow = "{f.name}"')
                print(f'job = "{job}"')
                print(f'pipeline = ""  # one of: {", ".join(PIPELINES)}; triggers: {", ".join(f.triggers)}')
                print('cadence = ""')
                print("gate_mirrored = false")
                print()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--print-missing",
        action="store_true",
        help="emit [[lane]] TOML stubs for uncensused jobs and exit 0",
    )
    args = parser.parse_args(argv)

    facts = parse_workflows()
    census = load_census()
    if args.print_missing:
        print_missing(facts, census)
        return 0

    rules = lint_records.load()
    violations = collect_violations(facts, census)
    if not violations:
        print(
            f"Lane census matches reality exactly "
            f"({len(census.lanes)} lanes, {len(census.quarantine)} quarantine rows, "
            f"{sum(len(f.jobs) for f in facts)} jobs across {len(facts)} workflows)."
        )
        return 0
    for rule_id, site, detail in violations:
        print(lint_records.render_diagnostic(rules.rule(rule_id), site, detail))
        print()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
