from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import AsyncConnection


async def assert_background_outbox_schema(conn: AsyncConnection) -> None:
    columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"] for column in inspect(sync_conn).get_columns("background_outbox_task")
        }
    )
    assert {
        "id",
        "task_name",
        "queue",
        "args_json",
        "kwargs_json",
        "idempotency_key",
        "status",
        "available_at",
        "attempt_count",
        "publish_claim_id",
        "locked_by",
        "locked_at",
        "lock_expires_at",
        "published_task_id",
        "published_at",
        "last_error_code",
        "last_error_message",
        "created_at",
        "updated_at",
    } <= columns

    checks = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_check_constraints("background_outbox_task")
        }
    )
    assert "ck_background_outbox_task_status" in checks

    indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"] for index in inspect(sync_conn).get_indexes("background_outbox_task")
        }
    )
    assert {
        "ix_background_outbox_task_due",
        "ix_background_outbox_task_expired_publish",
        "ix_background_outbox_task_task_name",
        "ix_background_outbox_task_status",
        "ux_background_outbox_task_idempotency_key",
    } <= indexes
