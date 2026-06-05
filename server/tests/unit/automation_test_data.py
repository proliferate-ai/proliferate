from datetime import datetime
import uuid

from proliferate.constants.automations import (
    AUTOMATION_OWNER_SCOPE_PERSONAL,
    AUTOMATION_TARGET_MODE_LOCAL,
    AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
)
from proliferate.db import engine as engine_module
from proliferate.db.models.auth import User
from proliferate.db.models.automations import Automation
from proliferate.db.models.cloud.agent_run_config import CloudAgentRunConfig
from proliferate.db.models.cloud.repo_config import CloudRepoConfig
from proliferate.db.store.automation_runs import create_manual_run_for_user


def _agent_snapshot(config: CloudAgentRunConfig) -> dict[str, object]:
    return {
        "config_id": str(config.id),
        "config_name": config.name,
        "agent_kind": config.agent_kind,
        "model_id": config.model_id,
        "control_values": dict(config.control_values_json or {}),
        "owner_scope_at_snapshot": config.owner_scope,
    }


async def ensure_user(user_id: uuid.UUID) -> None:
    async with engine_module.async_session_factory() as session:
        if await session.get(User, user_id) is not None:
            return
        session.add(
            User(
                id=user_id,
                email=f"automation-test-{user_id}@example.com",
                hashed_password="!",
                is_active=True,
                is_superuser=False,
                is_verified=True,
            )
        )
        await session.commit()


async def create_cloud_automation(user_id: uuid.UUID, now: datetime) -> uuid.UUID:
    return await _create_automation(
        user_id=user_id,
        now=now,
        repo_owner="proliferate-ai",
        repo_name="proliferate",
        repo_configured=True,
        title="Daily check",
        prompt="Original prompt",
        target_mode=AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
        model_id="gpt-5.4",
        control_values={"mode": "code", "effort": "medium"},
    )


async def create_local_automation(user_id: uuid.UUID, now: datetime) -> uuid.UUID:
    return await _create_automation(
        user_id=user_id,
        now=now,
        repo_owner="Proliferate-AI",
        repo_name="Proliferate",
        repo_configured=False,
        title="Local check",
        prompt="Check locally",
        target_mode=AUTOMATION_TARGET_MODE_LOCAL,
        model_id="auto",
        control_values={},
    )


async def create_manual_run(user_id: uuid.UUID, automation_id: uuid.UUID):
    async with engine_module.async_session_factory() as session:
        automation = await session.get(Automation, automation_id)
        assert automation is not None
        run_config = await session.get(CloudAgentRunConfig, automation.cloud_agent_run_config_id)
        assert run_config is not None
        run = await create_manual_run_for_user(
            session,
            user_id=user_id,
            automation_id=automation_id,
            agent_run_config_snapshot_json=_agent_snapshot(run_config),
        )
        await session.commit()
        return run


async def _create_automation(
    *,
    user_id: uuid.UUID,
    now: datetime,
    repo_owner: str,
    repo_name: str,
    repo_configured: bool,
    title: str,
    prompt: str,
    target_mode: str,
    model_id: str,
    control_values: dict[str, object],
) -> uuid.UUID:
    await ensure_user(user_id)
    async with engine_module.async_session_factory() as session:
        repo = CloudRepoConfig(
            owner_scope=AUTOMATION_OWNER_SCOPE_PERSONAL,
            user_id=user_id,
            git_owner=repo_owner,
            git_repo_name=repo_name,
            configured=repo_configured,
            configured_at=now if repo_configured else None,
            default_branch="main",
            env_vars_ciphertext="",
            env_vars_version=0,
            setup_script="",
            setup_script_version=0,
            files_version=0,
            created_at=now,
            updated_at=now,
        )
        session.add(repo)
        await session.flush()
        run_config = CloudAgentRunConfig(
            owner_scope=AUTOMATION_OWNER_SCOPE_PERSONAL,
            owner_user_id=user_id,
            organization_id=None,
            created_by_user_id=user_id,
            name=f"{title} config",
            agent_kind="codex",
            model_id=model_id,
            control_values_json=control_values,
            usable_in_personal_sandboxes=True,
            usable_in_shared_sandboxes=False,
            seed_key=None,
            system_default_rank=None,
            status="active",
            archived_at=None,
            created_at=now,
            updated_at=now,
        )
        session.add(run_config)
        await session.flush()
        automation = Automation(
            owner_scope=AUTOMATION_OWNER_SCOPE_PERSONAL,
            owner_user_id=user_id,
            organization_id=None,
            created_by_user_id=user_id,
            cloud_repo_config_id=repo.id,
            title=title,
            prompt=prompt,
            schedule_rrule="RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
            schedule_timezone="UTC",
            schedule_summary="Daily at 09:00 in UTC",
            target_mode=target_mode,
            cloud_agent_run_config_id=run_config.id,
            enabled=True,
            paused_at=None,
            next_run_at=now,
            last_scheduled_at=None,
            created_at=now,
            updated_at=now,
        )
        session.add(automation)
        await session.commit()
        return automation.id
