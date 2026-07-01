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
    pass


@dataclass(frozen=True)
class SandboxIOTarget:
    provider: SandboxProvider
    sandbox: Any
    endpoint: RuntimeEndpoint
    runtime_context: SandboxRuntimeContext
