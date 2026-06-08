from proliferate.lib.product.workspace_naming import (
    pick_generated_workspace_name,
    resolve_generated_branch_name,
    suffix_branch_leaf,
)


def test_pick_generated_workspace_name_is_deterministic_for_seed() -> None:
    first = pick_generated_workspace_name(seed="run-1")
    second = pick_generated_workspace_name(seed="run-1")

    assert first == second


def test_resolve_generated_branch_name_suffixes_branch_leaf() -> None:
    branch = resolve_generated_branch_name(
        "automation/otter",
        {"automation/otter", "automation/otter-2"},
    )

    assert branch == "automation/otter-3"


def test_suffix_branch_leaf_preserves_prefix() -> None:
    assert suffix_branch_leaf("codex/otter", 2) == "codex/otter-2"
    assert suffix_branch_leaf("otter", 2) == "otter-2"
