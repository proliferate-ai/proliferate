from proliferate.db.store.cloud_sync.materialized_workspace_results import (
    materialized_workspace_result,
)


def test_materialized_workspace_path_reads_worktree_results_only() -> None:
    worktree_result = materialized_workspace_result(
        kind="materialize_workspace",
        status="accepted",
        result_json=(
            '{"mode":"worktree","repoRootId":"root","path":"/workspace/otter-2",'
            '"kind":"worktree","anyharnessWorkspaceId":"workspace-1"}'
        ),
    )
    assert worktree_result is not None
    assert worktree_result.worktree_path == "/workspace/otter-2"

    existing_path_result = materialized_workspace_result(
        kind="materialize_workspace",
        status="accepted",
        result_json=(
            '{"mode":"existing_path","repoRootId":"root","path":"/workspace/repo",'
            '"kind":"local","anyharnessWorkspaceId":"workspace-1"}'
        ),
    )
    assert existing_path_result is not None
    assert existing_path_result.worktree_path is None
