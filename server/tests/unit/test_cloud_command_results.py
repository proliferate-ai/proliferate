from proliferate.db.store.cloud_sync.command_results import _materialized_workspace_path


def test_materialized_workspace_path_reads_worktree_results_only() -> None:
    assert (
        _materialized_workspace_path(
            kind="materialize_workspace",
            status="accepted",
            result_json=(
                '{"mode":"worktree","repoRootId":"root","path":"/workspace/otter-2",'
                '"kind":"worktree","anyharnessWorkspaceId":"workspace-1"}'
            ),
        )
        == "/workspace/otter-2"
    )
    assert _materialized_workspace_path(
        kind="materialize_workspace",
        status="accepted",
        result_json=(
            '{"mode":"existing_path","repoRootId":"root","path":"/workspace/repo",'
            '"kind":"local","anyharnessWorkspaceId":"workspace-1"}'
        ),
    ) is None
