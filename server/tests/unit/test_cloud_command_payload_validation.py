import pytest

from proliferate.constants.cloud import CloudCommandKind
from proliferate.server.cloud.commands.domain.payload import validate_command_payload
from proliferate.server.cloud.errors import CloudApiError


def test_managed_materialize_workspace_rejects_branch_suffix_policy() -> None:
    with pytest.raises(CloudApiError) as exc_info:
        validate_command_payload(
            kind=CloudCommandKind.materialize_workspace.value,
            payload={
                "mode": "worktree",
                "repoRootId": "repo-root-1",
                "targetPath": "/workspace/otter",
                "newBranchName": "codex/otter",
                "nameConflictPolicy": "suffix_path_and_branch",
            },
        )

    assert exc_info.value.code == "cloud_command_materialize_workspace_payload_invalid"


def test_managed_materialize_workspace_accepts_path_suffix_policy() -> None:
    validate_command_payload(
        kind=CloudCommandKind.materialize_workspace.value,
        payload={
            "mode": "worktree",
            "repoRootId": "repo-root-1",
            "targetPath": "/workspace/otter",
            "newBranchName": "codex/otter",
            "nameConflictPolicy": "suffix_path",
        },
    )
