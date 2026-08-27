"""Tests for scripts/check_lanes.py — the lane census engine (PROD-LANE-001/002/003)."""

from __future__ import annotations

import datetime as dt
import io
import sys
import tempfile
import textwrap
import unittest
from contextlib import redirect_stdout
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts import check_lanes  # noqa: E402

TODAY = dt.date(2026, 8, 27)

PR_WORKFLOW = textwrap.dedent(
    """
    name: CI

    on:
      push:
        branches: [main]
      pull_request:
      workflow_dispatch:

    jobs:
      # a comment between jobs must not confuse the parser
      repo-shape:
        name: Repo shape checks
        runs-on: ubuntu-latest
        steps:
          - run: echo ok
      analyze:  # trailing comment on a job id
        strategy:
          matrix:
            language: [python, rust]
        steps:
          - run: echo ${{ matrix.language }}
    """
).lstrip()

REUSABLE_WORKFLOW = textwrap.dedent(
    """
    name: Deploy Server

    on:
      workflow_call:
        inputs:
          environment:
            type: string

    jobs:
      deploy:
        runs-on: ubuntu-latest
        steps:
          - run: echo deploy
    """
).lstrip()

DISPATCH_WORKFLOW = textwrap.dedent(
    """
    name: Parked lane

    on:
      workflow_dispatch:

    jobs:
      provisioning:
        runs-on: ubuntu-latest
        continue-on-error: true
        steps:
          - run: echo provisional
      smoke:
        runs-on: ubuntu-latest
        steps:
          - name: soft step
            continue-on-error: ${{ matrix.os == 'windows' }}
            run: echo soft
          - continue-on-error: true
            run: echo dash-first-key form
    """
).lstrip()


def census_toml(*rows: str) -> str:
    return "\n".join(rows) + "\n"


def lane(workflow: str, job: str, pipeline: str, **extra: str) -> str:
    lines = [
        "[[lane]]",
        f'workflow = "{workflow}"',
        f'job = "{job}"',
        f'pipeline = "{pipeline}"',
        'cadence = "test"',
        "gate_mirrored = false",
    ]
    lines.extend(f'{key} = "{value}"' for key, value in extra.items())
    return "\n".join(lines) + "\n"


def quarantine(workflow: str, job: str, expires: str) -> str:
    return (
        "[[quarantine]]\n"
        f'workflow = "{workflow}"\n'
        f'job = "{job}"\n'
        'owner = "tests"\n'
        'reason = "fixture"\n'
        f'expires = "{expires}"\n'
    )


class Fixture:
    def __init__(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.workflows = self.root / "workflows"
        self.workflows.mkdir()
        self.census_path = self.root / "lanes.toml"

    def cleanup(self) -> None:
        self._tmp.cleanup()

    def write_workflow(self, name: str, body: str) -> None:
        (self.workflows / name).write_text(body, encoding="utf-8")

    def write_census(self, body: str) -> None:
        self.census_path.write_text(body, encoding="utf-8")

    def violations(self) -> list[tuple[str, str, str]]:
        facts = check_lanes.parse_workflows(self.workflows)
        census = check_lanes.load_census(self.census_path)
        return check_lanes.collect_violations(facts, census, today=TODAY)


class ParserTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fx = Fixture()
        self.addCleanup(self.fx.cleanup)

    def test_extracts_triggers_jobs_and_continue_on_error(self) -> None:
        self.fx.write_workflow("ci.yml", PR_WORKFLOW)
        self.fx.write_workflow("_deploy-server.yml", REUSABLE_WORKFLOW)
        self.fx.write_workflow("parked.yml", DISPATCH_WORKFLOW)
        facts = {f.name: f for f in check_lanes.parse_workflows(self.fx.workflows)}

        self.assertEqual(facts["ci.yml"].triggers, ("push", "pull_request", "workflow_dispatch"))
        # a matrix job is one job id; a trailing comment on the id line is fine
        self.assertEqual(facts["ci.yml"].jobs, ("repo-shape", "analyze"))
        self.assertEqual(facts["ci.yml"].continue_on_error, ())

        self.assertEqual(facts["_deploy-server.yml"].triggers, ("workflow_call",))
        self.assertEqual(facts["_deploy-server.yml"].jobs, ("deploy",))

        parked = facts["parked.yml"]
        self.assertEqual(parked.triggers, ("workflow_dispatch",))
        self.assertEqual(parked.jobs, ("provisioning", "smoke"))
        # job-level, step-level, and dash-first-key occurrences all attribute
        # to their job (the dash form was the refuter's constructed falsifier)
        self.assertEqual(
            [job for job, _ in parked.continue_on_error],
            ["provisioning", "smoke", "smoke"],
        )

    def test_rejects_inline_on_and_tabs(self) -> None:
        self.fx.write_workflow("inline.yml", "name: x\non: [push]\njobs:\n  a:\n    steps: []\n")
        with self.assertRaises(ValueError):
            check_lanes.parse_workflow(self.fx.workflows / "inline.yml")
        self.fx.write_workflow("tabs.yml", "name: x\non:\n\tpush:\njobs:\n  a:\n    steps: []\n")
        with self.assertRaises(ValueError):
            check_lanes.parse_workflow(self.fx.workflows / "tabs.yml")

    def test_requires_on_and_jobs_blocks(self) -> None:
        self.fx.write_workflow("nojobs.yml", "name: x\non:\n  push:\n")
        with self.assertRaises(ValueError):
            check_lanes.parse_workflow(self.fx.workflows / "nojobs.yml")

    def test_flow_form_and_quoted_job_ids_fail_loud(self) -> None:
        # both shapes would be silently dropped (and a quoted job's
        # continue-on-error would attribute to the PRECEDING job)
        self.fx.write_workflow(
            "flow.yml",
            "name: x\non:\n  push:\njobs:\n  sneaky: { runs-on: ubuntu-latest }\n",
        )
        with self.assertRaises(ValueError) as ctx:
            check_lanes.parse_workflow(self.fx.workflows / "flow.yml")
        self.assertIn("job depth", str(ctx.exception))
        self.fx.write_workflow(
            "quoted.yml",
            'name: x\non:\n  push:\njobs:\n  "quoted":\n    steps: []\n',
        )
        with self.assertRaises(ValueError) as ctx:
            check_lanes.parse_workflow(self.fx.workflows / "quoted.yml")
        self.assertIn("job depth", str(ctx.exception))

    def test_sequence_form_on_fails_loud(self) -> None:
        self.fx.write_workflow(
            "seq.yml", "name: x\non:\n  - push\njobs:\n  a:\n    steps: []\n"
        )
        with self.assertRaises(ValueError) as ctx:
            check_lanes.parse_workflow(self.fx.workflows / "seq.yml")
        self.assertIn("sequence-form", str(ctx.exception))

    def test_top_level_key_after_jobs_fails_loud(self) -> None:
        # a trailing top-level block would silently end job parsing and
        # under-count the census; the parser must refuse instead
        self.fx.write_workflow(
            "trailing.yml",
            "name: x\non:\n  push:\njobs:\n  a:\n    steps: []\nenv:\n  X: 1\n",
        )
        with self.assertRaises(ValueError) as ctx:
            check_lanes.parse_workflow(self.fx.workflows / "trailing.yml")
        self.assertIn("after `jobs:`", str(ctx.exception))


class CensusTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fx = Fixture()
        self.addCleanup(self.fx.cleanup)
        self.fx.write_workflow("ci.yml", PR_WORKFLOW)
        self.fx.write_workflow("_deploy-server.yml", REUSABLE_WORKFLOW)
        self.fx.write_workflow("parked.yml", DISPATCH_WORKFLOW)
        self.green = census_toml(
            lane("ci.yml", "repo-shape", "pr"),
            lane("ci.yml", "analyze", "pr"),
            lane("_deploy-server.yml", "deploy", "reusable"),
            lane("parked.yml", "provisioning", "dispatch-with-sunset", sunset="2026-09-30"),
            lane("parked.yml", "smoke", "dispatch-with-sunset", sunset="2026-09-30"),
            quarantine("parked.yml", "provisioning", "2026-09-30"),
            quarantine("parked.yml", "smoke", "2026-09-30"),
        )

    def rule_ids(self) -> list[str]:
        return [rule_id for rule_id, _, _ in self.fx.violations()]

    def test_matching_census_is_green(self) -> None:
        self.fx.write_census(self.green)
        self.assertEqual(self.fx.violations(), [])

    def test_missing_row_is_a_census_violation(self) -> None:
        self.fx.write_census(self.green.replace(lane("ci.yml", "analyze", "pr"), ""))
        violations = self.fx.violations()
        self.assertEqual([v[0] for v in violations], [check_lanes.CENSUS_RULE_ID])
        self.assertIn("ci.yml:analyze", violations[0][1])

    def test_stale_row_is_a_census_violation(self) -> None:
        self.fx.write_census(self.green + lane("ci.yml", "gone", "pr"))
        violations = self.fx.violations()
        self.assertEqual([v[0] for v in violations], [check_lanes.CENSUS_RULE_ID])
        self.assertIn("stale", violations[0][2])

    def test_pipeline_must_match_a_real_trigger(self) -> None:
        # ci.yml has no schedule trigger, so "nightly" is a lie
        self.fx.write_census(
            self.green.replace(lane("ci.yml", "repo-shape", "pr"), lane("ci.yml", "repo-shape", "nightly"))
        )
        self.assertEqual(self.rule_ids(), [check_lanes.CADENCE_RULE_ID])

    def test_dispatch_only_lane_needs_a_sunset(self) -> None:
        # claiming "nightly" on a dispatch-only workflow fails the trigger
        # contract; claiming dispatch-with-sunset without a date fails too
        self.fx.write_census(
            self.green.replace(
                lane("parked.yml", "smoke", "dispatch-with-sunset", sunset="2026-09-30"),
                lane("parked.yml", "smoke", "dispatch-with-sunset"),
            )
        )
        violations = self.fx.violations()
        self.assertEqual([v[0] for v in violations], [check_lanes.CADENCE_RULE_ID])
        self.assertIn("requires sunset", violations[0][2])

    def test_dispatch_only_lane_claiming_main_is_dishonest(self) -> None:
        self.fx.write_census(
            self.green.replace(
                lane("parked.yml", "smoke", "dispatch-with-sunset", sunset="2026-09-30"),
                lane("parked.yml", "smoke", "main"),
            )
        )
        ids = self.rule_ids()
        # both the trigger contract and the dispatch-only rule fire
        self.assertEqual(ids, [check_lanes.CADENCE_RULE_ID, check_lanes.CADENCE_RULE_ID])

    def test_dispatch_only_cannot_launder_as_release_or_prod(self) -> None:
        # relabeling a dispatch-only lane release/prod with the sunset deleted
        # must fail: workflow_dispatch is never the qualifying trigger
        for pipeline in ("release", "prod"):
            self.fx.write_census(
                self.green.replace(
                    lane("parked.yml", "smoke", "dispatch-with-sunset", sunset="2026-09-30"),
                    lane("parked.yml", "smoke", pipeline),
                )
            )
            ids = self.rule_ids()
            self.assertEqual(
                ids,
                [check_lanes.CADENCE_RULE_ID, check_lanes.CADENCE_RULE_ID],
                f"laundering as {pipeline} must fire both cadence checks",
            )

    def test_prod_with_a_schedule_is_honest(self) -> None:
        self.fx.write_workflow(
            "cron-prod.yml",
            "name: x\non:\n  schedule:\n    - cron: '0 9 * * *'\n  workflow_dispatch:\njobs:\n  ship:\n    steps: []\n",
        )
        self.fx.write_census(self.green + lane("cron-prod.yml", "ship", "prod"))
        self.assertEqual(self.fx.violations(), [])

    def test_expired_sunset_fails(self) -> None:
        self.fx.write_census(
            self.green.replace(
                lane("parked.yml", "smoke", "dispatch-with-sunset", sunset="2026-09-30"),
                lane("parked.yml", "smoke", "dispatch-with-sunset", sunset="2026-08-01"),
            )
        )
        violations = self.fx.violations()
        self.assertEqual([v[0] for v in violations], [check_lanes.CADENCE_RULE_ID])
        self.assertIn("has passed", violations[0][2])

    def test_reusable_requires_workflow_call(self) -> None:
        self.fx.write_census(
            self.green.replace(lane("ci.yml", "analyze", "pr"), lane("ci.yml", "analyze", "reusable"))
        )
        self.assertEqual(self.rule_ids(), [check_lanes.CADENCE_RULE_ID])

    def test_continue_on_error_needs_quarantine(self) -> None:
        self.fx.write_census(self.green.replace(quarantine("parked.yml", "smoke", "2026-09-30"), ""))
        violations = self.fx.violations()
        # one diagnostic per occurrence line: smoke carries two
        self.assertEqual(
            [v[0] for v in violations],
            [check_lanes.QUARANTINE_RULE_ID, check_lanes.QUARANTINE_RULE_ID],
        )
        for violation in violations:
            self.assertIn("parked.yml:smoke", violation[1])

    def test_expired_quarantine_fails(self) -> None:
        self.fx.write_census(
            self.green.replace(
                quarantine("parked.yml", "smoke", "2026-09-30"),
                quarantine("parked.yml", "smoke", "2026-08-01"),
            )
        )
        violations = self.fx.violations()
        # the expired row is reported at each surviving occurrence line
        self.assertEqual(
            [v[0] for v in violations],
            [check_lanes.QUARANTINE_RULE_ID, check_lanes.QUARANTINE_RULE_ID],
        )
        for violation in violations:
            self.assertIn("expired", violation[2])

    def test_stale_quarantine_fails(self) -> None:
        self.fx.write_census(self.green + quarantine("ci.yml", "repo-shape", "2026-09-30"))
        violations = self.fx.violations()
        self.assertEqual([v[0] for v in violations], [check_lanes.QUARANTINE_RULE_ID])
        self.assertIn("stale", violations[0][2])

    def test_unknown_pipeline_and_duplicate_rows_are_load_errors(self) -> None:
        self.fx.write_census(self.green.replace('pipeline = "reusable"', 'pipeline = "sometimes"'))
        with self.assertRaises(ValueError):
            self.fx.violations()
        self.fx.write_census(self.green + lane("ci.yml", "repo-shape", "pr"))
        with self.assertRaises(ValueError):
            self.fx.violations()

    def test_print_missing_emits_a_stub_per_uncensused_job(self) -> None:
        self.fx.write_census(self.green.replace(lane("ci.yml", "analyze", "pr"), ""))
        facts = check_lanes.parse_workflows(self.fx.workflows)
        census = check_lanes.load_census(self.fx.census_path)
        out = io.StringIO()
        with redirect_stdout(out):
            check_lanes.print_missing(facts, census)
        self.assertIn('workflow = "ci.yml"', out.getvalue())
        self.assertIn('job = "analyze"', out.getvalue())
        self.assertEqual(out.getvalue().count("[[lane]]"), 1)


class LiveRepositoryTests(unittest.TestCase):
    """The real tree parses and every real job is censused (date-independent)."""

    def test_every_workflow_parses_and_every_job_has_a_row(self) -> None:
        facts = check_lanes.parse_workflows()
        census = check_lanes.load_census()
        self.assertGreater(len(facts), 0)
        missing = [
            (f.name, job)
            for f in facts
            for job in f.jobs
            if (f.name, job) not in census.lanes
        ]
        self.assertEqual(missing, [])
        for f in facts:
            self.assertTrue(f.triggers, f"{f.name} parsed no triggers")

    def test_the_three_records_exist(self) -> None:
        from scripts import lint_records

        rules = lint_records.load()
        for rule_id in (
            check_lanes.CENSUS_RULE_ID,
            check_lanes.CADENCE_RULE_ID,
            check_lanes.QUARANTINE_RULE_ID,
        ):
            self.assertEqual(rules.rule(rule_id).enforced_by, "scripts/check_lanes.py")


if __name__ == "__main__":
    unittest.main()
