"""Commit + ORM-row conversion helpers for org usage/budget-limit service.

Split out of service.py because the repo-shape server-boundary check forbids
service.py from importing DB session entrypoints or ORM models directly
(SERVICE_DB_ENGINE_IMPORT / SERVICE_ORM_IMPORT) — mirrors the transactions.py
convention used elsewhere (e.g. organizations/sso/transactions.py).
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import commit_session
from proliferate.db.models.billing import BillingBudgetLimit
from proliferate.server.organizations.usage.models import BudgetLimit


async def commit_replaced_limits(db: AsyncSession) -> None:
    await commit_session(db)


def budget_limit_from_row(row: BillingBudgetLimit) -> BudgetLimit:
    return BudgetLimit(
        id=row.id,
        user_id=row.user_id,
        kind=row.kind,
        window=row.window,
        cap_value=float(row.cap_value),
        enabled=row.enabled,
        updated_at=row.updated_at,
    )
