"""Typed domain values for cloud target config materialization."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TargetConfigCommandRef:
    target_config_id: str
    config_version: int
