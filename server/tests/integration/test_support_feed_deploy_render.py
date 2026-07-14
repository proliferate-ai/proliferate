"""Deploy-time task-render contract tests for the private support feed.

The render (MERGE_JQ) and fail-closed check (ASSERT_JQ) are pure jq programs
embedded verbatim in `.github/workflows/_deploy-server.yml`. We extract and run
them with real jq over synthetic task JSON; no AWS call and no secret value is
involved. Split from ``test_support_feed.py`` solely to satisfy the repo-shape
600-line source cap (``scripts/check_max_lines.py``); the tests are relocated
unchanged.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

_REPO_ROOT = Path(__file__).resolve().parents[3]
_DEPLOY_WORKFLOW = _REPO_ROOT / ".github" / "workflows" / "_deploy-server.yml"
_CONTAINER = "server"
_PROD_FEED_ARN = (
    "arn:aws:secretsmanager:us-east-1:157466816238:secret:proliferate/prod/support-feed-NoKayy"
)
_FEED_VALUE_FROM = f"{_PROD_FEED_ARN}:supportFeedToken::"
# Distinct ARNs used only to build synthetic prior/duplicate task states.
_STALE_VALUE_FROM = "arn:aws:secretsmanager:us-east-1:1:secret:stale:supportFeedToken::"
_OTHER_VALUE_FROM = "arn:aws:secretsmanager:us-east-1:1:secret:other:supportFeedToken::"

_requires_jq = pytest.mark.skipif(
    shutil.which("jq") is None, reason="jq is required for the render contract tests"
)


def _extract_heredoc(run_script: str, tag: str) -> str:
    """Return the body of a `<<'TAG' ... TAG` heredoc from the render step.

    ``run_script`` is the YAML-decoded step body, so the block-scalar indent is
    already stripped and each heredoc terminator sits at column 0.
    """

    opener = f"<<'{tag}'\n"
    start = run_script.index(opener) + len(opener)
    end = run_script.index(f"\n{tag}\n", start)
    body = run_script[start:end]
    assert body.strip(), f"heredoc {tag} is empty"
    return body


def _render_jq_programs() -> tuple[str, str]:
    workflow = yaml.safe_load(_DEPLOY_WORKFLOW.read_text())
    steps = workflow["jobs"]["deploy"]["steps"]
    run_script = next(s["run"] for s in steps if s.get("name") == "Render ECS task definition")
    return _extract_heredoc(run_script, "MERGE_JQ"), _extract_heredoc(run_script, "ASSERT_JQ")


def _run_jq(
    program: str, document: dict, tmp_path: Path, *args: str
) -> subprocess.CompletedProcess[str]:
    prog_file = tmp_path / "program.jq"
    doc_file = tmp_path / "document.json"
    prog_file.write_text(program)
    doc_file.write_text(json.dumps(document))
    return subprocess.run(
        ["jq", *args, "-f", str(prog_file), str(doc_file)],
        capture_output=True,
        text=True,
    )


def _merge(
    raw_task: dict, secret_updates: list[dict], tmp_path: Path, *, image: str = "new:tag"
) -> dict:
    merge_program, _ = _render_jq_programs()
    env_file = tmp_path / "env-updates.json"
    sec_file = tmp_path / "secret-updates.json"
    env_file.write_text(json.dumps([{"name": "API_URL", "value": "https://new"}]))
    sec_file.write_text(json.dumps(secret_updates))
    prog_file = tmp_path / "merge.jq"
    raw_file = tmp_path / "raw.json"
    prog_file.write_text(merge_program)
    raw_file.write_text(json.dumps(raw_task))
    result = subprocess.run(
        [
            "jq",
            "--arg",
            "container",
            _CONTAINER,
            "--arg",
            "image",
            image,
            "--slurpfile",
            "updates",
            str(env_file),
            "--slurpfile",
            "secret_updates",
            str(sec_file),
            "-f",
            str(prog_file),
            str(raw_file),
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def _assert_task(final_task: dict, tmp_path: Path) -> subprocess.CompletedProcess[str]:
    _, assert_program = _render_jq_programs()
    return _run_jq(assert_program, final_task, tmp_path, "--arg", "container", _CONTAINER)


def _server_container(task: dict) -> dict:
    (container,) = [c for c in task["containerDefinitions"] if c["name"] == _CONTAINER]
    return container


@_requires_jq
def test_render_projects_single_feed_secret_and_strips_inherited_plaintext(tmp_path: Path) -> None:
    # The live task inherits both a stale feed secret and a leaked plaintext
    # SUPPORT_FEED_BEARER_TOKEN. The render must dedupe to one secret and drop
    # the plaintext entry.
    raw_task = {
        "taskDefinitionArn": "arn:aws:ecs:us-east-1:1:task-definition/proliferate-prod-server:5",
        "revision": 5,
        "status": "ACTIVE",
        "requiresAttributes": [],
        "compatibilities": ["FARGATE"],
        "registeredAt": "t",
        "registeredBy": "who",
        "family": "proliferate-prod-server",
        "containerDefinitions": [
            {
                "name": _CONTAINER,
                "image": "old",
                "environment": [
                    {"name": "API_URL", "value": "old"},
                    {"name": "SUPPORT_FEED_BEARER_TOKEN", "value": "LEAKED-PLAINTEXT"},
                ],
                "secrets": [
                    {
                        "name": "SUPPORT_FEED_BEARER_TOKEN",
                        "valueFrom": _STALE_VALUE_FROM,
                    },
                    {"name": "OTHER", "valueFrom": "keepme"},
                ],
            },
            {"name": "sidecar", "image": "s"},
        ],
    }
    secret_updates = [
        {"name": "SUPPORT_FEED_BEARER_TOKEN", "valueFrom": _FEED_VALUE_FROM},
        {
            "name": "SUPPORT_LINEAR_API_KEY",
            "valueFrom": "/proliferate/prod/support/linear-api-key",
        },
    ]

    final = _merge(raw_task, secret_updates, tmp_path)
    container = _server_container(final)

    feed_secrets = [s for s in container["secrets"] if s["name"] == "SUPPORT_FEED_BEARER_TOKEN"]
    assert feed_secrets == [{"name": "SUPPORT_FEED_BEARER_TOKEN", "valueFrom": _FEED_VALUE_FROM}]
    assert [e for e in container["environment"] if e["name"] == "SUPPORT_FEED_BEARER_TOKEN"] == []
    # A non-feed inherited secret survives.
    assert any(s["name"] == "OTHER" for s in container["secrets"])
    # Mutable metadata is stripped before registration.
    for stripped in ("taskDefinitionArn", "revision", "status", "requiresAttributes"):
        assert stripped not in final
    # The rendered task passes the fail-closed assertion.
    assert _assert_task(final, tmp_path).returncode == 0


@_requires_jq
def test_render_assert_passes_on_well_formed_task(tmp_path: Path) -> None:
    task = {
        "containerDefinitions": [
            {
                "name": _CONTAINER,
                "environment": [{"name": "API_URL", "value": "x"}],
                "secrets": [{"name": "SUPPORT_FEED_BEARER_TOKEN", "valueFrom": _FEED_VALUE_FROM}],
            }
        ]
    }
    assert _assert_task(task, tmp_path).returncode == 0


@_requires_jq
@pytest.mark.parametrize(
    ("container", "expected_reason"),
    [
        pytest.param(
            {"name": _CONTAINER, "environment": [], "secrets": []},
            "expected exactly one SUPPORT_FEED_BEARER_TOKEN",
            id="missing-secret",
        ),
        pytest.param(
            {
                "name": _CONTAINER,
                "environment": [{"name": "SUPPORT_FEED_BEARER_TOKEN", "value": "leak"}],
                "secrets": [{"name": "SUPPORT_FEED_BEARER_TOKEN", "valueFrom": _FEED_VALUE_FROM}],
            },
            "must not be present as a plaintext environment entry",
            id="plaintext-duplicate",
        ),
        pytest.param(
            {
                "name": _CONTAINER,
                "environment": [],
                "secrets": [
                    {"name": "SUPPORT_FEED_BEARER_TOKEN", "valueFrom": _FEED_VALUE_FROM},
                    {
                        "name": "SUPPORT_FEED_BEARER_TOKEN",
                        "valueFrom": _OTHER_VALUE_FROM,
                    },
                ],
            },
            "expected exactly one SUPPORT_FEED_BEARER_TOKEN",
            id="duplicate-secret",
        ),
        pytest.param(
            {
                "name": _CONTAINER,
                "environment": [],
                "secrets": [
                    {"name": "SUPPORT_FEED_BEARER_TOKEN", "valueFrom": _PROD_FEED_ARN},
                ],
            },
            "must project the supportFeedToken field",
            id="wrong-field",
        ),
        pytest.param(
            {
                "name": _CONTAINER,
                "environment": [],
                "secrets": [
                    {
                        "name": "SUPPORT_FEED_BEARER_TOKEN",
                        "valueFrom": "/ssm/plain:supportFeedToken::",
                    },
                ],
            },
            "must reference a Secrets Manager secret ARN",
            id="not-secrets-manager-arn",
        ),
    ],
)
def test_render_assert_fails_closed(container: dict, expected_reason: str, tmp_path: Path) -> None:
    task = {"containerDefinitions": [container]}
    result = _assert_task(task, tmp_path)
    assert result.returncode != 0
    assert expected_reason in result.stderr
