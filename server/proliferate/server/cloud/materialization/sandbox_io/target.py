"""Shared sandbox I/O types."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from proliferate.integrations.sandbox import (
    RuntimeEndpoint,
    SandboxProvider,
    SandboxRuntimeContext,
)


class CloudMaterializationCommandError(RuntimeError):
    """A materialization sandbox command exited non-zero.

    ``exit_code`` carries the script's exit status so callers can map known
    materialization exit codes (e.g. the git-checkout guard's dirty/local-commit
    codes) to structured, actionable product errors instead of an opaque 500.
    """

    def __init__(self, message: str, *, exit_code: int | None = None) -> None:
        super().__init__(message)
        self.exit_code = exit_code


@dataclass(frozen=True)
class SandboxIOTarget:
    provider: SandboxProvider
    sandbox: Any
    endpoint: RuntimeEndpoint
    runtime_context: SandboxRuntimeContext
