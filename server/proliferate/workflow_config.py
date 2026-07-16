"""Managed Workflow settings mixed into the server configuration."""

from pydantic_settings import BaseSettings


class WorkflowSettings(BaseSettings):
    """Feature gate and projection freshness for managed Workflow delivery."""

    workflow_managed_runs_enabled: bool = False
    workflow_managed_freshness_stale_seconds: float = 60.0
