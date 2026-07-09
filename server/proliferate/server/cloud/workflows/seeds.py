"""Code-defined seed workflow-definition registry (track 1f).

``SEED_WORKFLOW_DEFINITIONS`` is the authoritative list of built-in ("seed")
workflows. ``sync_seed_workflow_definitions`` reconciles them into
``workflow`` / ``workflow_version`` (``is_seed=True``), matched by
``seed_slug``, without ever touching a user's own workflows — the same
reconcile discipline as the integration seed registry
(``proliferate.server.cloud.integrations.seeds``).

Every definition here is authored in the v2 ``definition_json`` shape
(data-contract §1: ``{version, name, description, inputs, integrations,
agents}``) and is validated against the real parser
(``proliferate.server.cloud.workflows.domain.definition.parse_definition``)
both here at import time (``_validate_seed``, called eagerly so a bad seed
fails fast/at boot) and in the reconciler test. Seeds only use RULED step
kinds — no ``human.approval`` (removed) and no agent-comms step.

Seeds are org-agnostic and repo-agnostic like every other definition: they
resolve their target at launch like any manual run (no pre-provisioned
workspace — that is PR F (f), explicitly out of scope for this track).
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_workflows import WorkflowRecord, upsert_seed_workflow
from proliferate.server.cloud.workflows.domain.definition import parse_definition


@dataclass(frozen=True)
class SeedWorkflowDefinition:
    slug: str
    name: str
    description: str
    definition: dict[str, object]


def _validate_seed(seed: SeedWorkflowDefinition) -> dict[str, object]:
    """Parse+canonicalize through the real v2 validator; raises if invalid."""

    canonical, _arg_specs = parse_definition(seed.definition, require_steps=True)
    return canonical


# --------------------------------------------------------------------------- #
# Seed registry
# --------------------------------------------------------------------------- #

_TRIAGE_ISSUE_DEFINITION: dict[str, object] = {
    "version": 1,
    "name": "Triage a GitHub issue",
    "description": (
        "Reads an issue, classifies it, and posts a structured verdict. A "
        "single-agent seed exercising agent.emit + required_invocation."
    ),
    "inputs": [
        {"name": "issue_url", "type": "text", "required": True},
    ],
    "integrations": ["github"],
    "agents": [
        {
            "slot": "triager",
            "harness": "claude",
            "model": "sonnet",
            "steps": [
                {
                    "kind": "agent.prompt",
                    "label": "Read the issue",
                    "prompt": (
                        "Read the GitHub issue at {{inputs.issue_url}}. Use the "
                        "GitHub tool to fetch its title, body, and labels before "
                        "you classify it."
                    ),
                    "required_invocation": {"provider": "github", "tool": "get_issue"},
                },
                {
                    "kind": "agent.emit",
                    "label": "Classify",
                    "name": "verdict",
                    "prompt": (
                        "Classify the issue you just read as one of bug, "
                        "feature, question, or duplicate, and give a one "
                        "sentence reason."
                    ),
                    "output_schema": {
                        "type": "object",
                        "properties": {
                            "category": {
                                "type": "string",
                                "enum": ["bug", "feature", "question", "duplicate"],
                            },
                            "reason": {"type": "string"},
                        },
                        "required": ["category", "reason"],
                    },
                },
            ],
        }
    ],
}

_FIX_AND_PR_DEFINITION: dict[str, object] = {
    "version": 1,
    "name": "Fix and open a PR",
    "description": (
        "Two-step sequential seed: implement a fix from a free-text "
        "description, then open a PR whose title/body reference the "
        "agent's own emitted summary via {{inputs.*}} and {{emit.field}}."
    ),
    "inputs": [
        {"name": "task", "type": "text", "required": True},
        {
            "name": "base_branch",
            "type": "text",
            "required": False,
            "default": "main",
        },
    ],
    "integrations": ["github"],
    "agents": [
        {
            "slot": "fixer",
            "harness": "claude",
            "model": "sonnet",
            "steps": [
                {
                    "kind": "agent.prompt",
                    "label": "Implement the fix",
                    "prompt": "Implement the following change: {{inputs.task}}",
                    "goal": {
                        "objective": "Implement {{inputs.task}} and leave the tree ready for review.",
                        "max_turns": 40,
                        "max_wall_secs": 1800,
                        "on_blocked": "fail",
                    },
                },
                {
                    "kind": "agent.emit",
                    "label": "Summarize the change",
                    "name": "summary",
                    "prompt": "Summarize the change you just made in one short paragraph.",
                    "output_schema": {
                        "type": "object",
                        "properties": {"title": {"type": "string"}, "body": {"type": "string"}},
                        "required": ["title", "body"],
                    },
                },
                {
                    "kind": "scm.open_pr",
                    "label": "Open the PR",
                    "base": "{{inputs.base_branch}}",
                    "title": "{{summary.title}}",
                    "body": "{{summary.body}}\n\nTask: {{inputs.task}}",
                    "draft": False,
                },
            ],
        }
    ],
}

_NOTIFY_ON_FINISH_DEFINITION: dict[str, object] = {
    "version": 1,
    "name": "Run checks and notify Slack",
    "description": (
        "Runs a shell command, branches on its exit, and posts the result to "
        "Slack — a notify-on-finish seed exercising shell.run + branch + "
        "Slack-only notify."
    ),
    "inputs": [
        {
            "name": "command",
            "type": "text",
            "required": False,
            "default": "make test",
        },
        {"name": "slack_channel_id", "type": "text", "required": True},
    ],
    "integrations": [],
    "agents": [
        {
            "slot": "runner",
            "harness": "claude",
            "model": "haiku",
            "steps": [
                {
                    "kind": "shell.run",
                    "label": "Run the command",
                    "command": "{{inputs.command}}",
                    "timeout_secs": 900,
                    "output_name": "run_result",
                },
                {
                    "kind": "agent.emit",
                    "label": "Read the result",
                    "name": "outcome",
                    "prompt": (
                        "The command {{inputs.command}} just finished running. "
                        "Inspect its output and report whether it passed."
                    ),
                    "output_schema": {
                        "type": "object",
                        "properties": {"passed": {"type": "boolean"}},
                        "required": ["passed"],
                    },
                },
                {
                    "kind": "branch",
                    "label": "Branch on result",
                    "on": "{{outcome.passed}}",
                    "cases": {
                        "true": {"to": "continue"},
                        "false": {"to": "continue"},
                    },
                },
                {
                    "kind": "notify",
                    "label": "Notify Slack",
                    "slack_channel_id": "{{inputs.slack_channel_id}}",
                    "message": "{{inputs.command}} finished — passed={{outcome.passed}}",
                },
            ],
        }
    ],
}

SEED_WORKFLOW_DEFINITIONS: tuple[SeedWorkflowDefinition, ...] = (
    SeedWorkflowDefinition(
        slug="triage-issue",
        name=str(_TRIAGE_ISSUE_DEFINITION["name"]),
        description=str(_TRIAGE_ISSUE_DEFINITION["description"]),
        definition=_TRIAGE_ISSUE_DEFINITION,
    ),
    SeedWorkflowDefinition(
        slug="fix-and-open-pr",
        name=str(_FIX_AND_PR_DEFINITION["name"]),
        description=str(_FIX_AND_PR_DEFINITION["description"]),
        definition=_FIX_AND_PR_DEFINITION,
    ),
    SeedWorkflowDefinition(
        slug="notify-on-finish",
        name=str(_NOTIFY_ON_FINISH_DEFINITION["name"]),
        description=str(_NOTIFY_ON_FINISH_DEFINITION["description"]),
        definition=_NOTIFY_ON_FINISH_DEFINITION,
    ),
)


async def sync_seed_workflow_definitions(db: AsyncSession) -> tuple[WorkflowRecord, ...]:
    """Upsert every seed workflow definition into ``workflow``/``workflow_version``.

    Idempotent: matches on ``is_seed=True`` + ``seed_slug``, appends a new
    version only when the canonical definition actually changed, and never
    touches a user-owned workflow row.
    """

    records: list[WorkflowRecord] = []
    for seed in SEED_WORKFLOW_DEFINITIONS:
        canonical = _validate_seed(seed)
        workflow, _version = await upsert_seed_workflow(
            db,
            seed_slug=seed.slug,
            name=seed.name,
            description=seed.description,
            definition_json=canonical,
        )
        records.append(workflow)
    return tuple(records)
