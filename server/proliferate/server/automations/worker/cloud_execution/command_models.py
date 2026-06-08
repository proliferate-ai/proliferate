"""Typed command payload/result helpers for automation stages."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class EnsureRepoCheckoutPayload:
    provider: str
    owner: str
    name: str
    path: str
    base_branch: str | None = None

    def to_json(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "provider": self.provider,
            "owner": self.owner,
            "name": self.name,
            "path": self.path,
        }
        if self.base_branch:
            payload["baseBranch"] = self.base_branch
        return payload


@dataclass(frozen=True)
class EnsureRepoCheckoutResult:
    path: str
    provider: str
    owner: str
    name: str
    current_head: str | None
    base_branch: str | None


@dataclass(frozen=True)
class MaterializeWorkspacePayload:
    mode: str
    path: str | None = None
    display_name: str | None = None
    repo_root_id: str | None = None
    target_path: str | None = None
    new_branch_name: str | None = None
    base_branch: str | None = None
    checkout_mode: Literal["new_branch", "detached_ref"] | None = None
    name_conflict_policy: Literal[
        "fail",
        "suffix_path",
    ] | None = None
    origin: dict[str, object] | None = None
    creator_context: dict[str, object] | None = None

    def to_json(self) -> dict[str, object]:
        if self.mode == "existing_path":
            payload: dict[str, object] = {
                "mode": "existing_path",
                "path": self.path or "",
            }
            if self.display_name:
                payload["displayName"] = self.display_name
        else:
            payload = {
                "mode": "worktree",
                "repoRootId": self.repo_root_id or "",
                "targetPath": self.target_path or "",
                "newBranchName": self.new_branch_name or "",
            }
            if self.base_branch:
                payload["baseBranch"] = self.base_branch
            if self.checkout_mode:
                payload["checkoutMode"] = self.checkout_mode
            if self.name_conflict_policy:
                payload["nameConflictPolicy"] = self.name_conflict_policy
        if self.origin:
            payload["origin"] = self.origin
        if self.creator_context:
            payload["creatorContext"] = self.creator_context
        return payload


@dataclass(frozen=True)
class MaterializeWorkspaceResult:
    anyharness_workspace_id: str
    repo_root_id: str
    path: str
    kind: str
    current_branch: str | None


@dataclass(frozen=True)
class StartSessionPayload:
    workspace_id: str
    agent_kind: str
    model_id: str | None
    mode_id: str | None
    origin: dict[str, object]

    def to_json(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "workspaceId": self.workspace_id,
            "agentKind": self.agent_kind,
            "origin": self.origin,
        }
        if self.model_id:
            payload["modelId"] = self.model_id
        if self.mode_id:
            payload["modeId"] = self.mode_id
        return payload


@dataclass(frozen=True)
class StartSessionResult:
    session_id: str


@dataclass(frozen=True)
class SendPromptPayload:
    text: str
    prompt_id: str

    def to_json(self) -> dict[str, object]:
        return {
            "promptId": self.prompt_id,
            "blocks": [{"type": "text", "text": self.text}],
        }


def require_string(
    payload: dict[str, object],
    field: str,
    *,
    source: str,
) -> str:
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{source} is missing required field {field}.")
    return value.strip()


def optional_string(payload: dict[str, object], field: str) -> str | None:
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip()
