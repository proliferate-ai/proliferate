"""Workspace name generation helpers."""

from proliferate.lib.product.workspace_naming.branches import (
    resolve_generated_branch_name,
    suffix_branch_leaf,
)
from proliferate.lib.product.workspace_naming.selection import pick_generated_workspace_name

__all__ = [
    "pick_generated_workspace_name",
    "resolve_generated_branch_name",
    "suffix_branch_leaf",
]
