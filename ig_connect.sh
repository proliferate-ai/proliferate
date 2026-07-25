#!/usr/bin/env bash
# Connect the no-auth "cloudflare_docs" integration for the currently logged-in
# desktop user (the owner of the most recent desktop worker), since the
# integrations settings UI is not built yet. Run after signing in to the app.
set -euo pipefail
PROFILE="${PROFILE:-igtest}"
LAUNCH_ENV="$HOME/.proliferate-local/dev/profiles/$PROFILE/launch.env"
cd "$(dirname "$0")/server"
# shellcheck disable=SC1090
set -a; . "$LAUNCH_ENV"; set +a
uv run python - <<'PY'
import asyncio, os
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
async def main():
    url = os.environ["DATABASE_URL"]
    eng = create_async_engine(url)
    S = async_sessionmaker(eng, expire_on_commit=False)
    from proliferate.server.cloud.integrations.seeds import sync_seed_definitions
    from proliferate.db.store.integrations import definitions as defs, accounts as accts
    from proliferate.db.models.cloud.runtime_workers import CloudRuntimeWorker
    async with S() as db:
        worker = (await db.execute(select(CloudRuntimeWorker).where(CloudRuntimeWorker.runtime_kind=="desktop").order_by(desc(CloudRuntimeWorker.enrolled_at)))).scalars().first()
        if worker is None:
            print("No desktop worker yet — sign in to the app first."); return
        await sync_seed_definitions(db)
        d = await defs.get_seed_by_namespace(db, "cloudflare_docs")
        await accts.upsert_account(db, user_id=worker.owner_user_id, definition_id=d.id, auth_kind="none", status="ready")
        await db.commit()
        print(f"Connected 'cloudflare_docs' for user {worker.owner_user_id} (worker {worker.id}).")
        print("Now open a session and ask the agent to use the cloudflare_docs integration.")
    await eng.dispose()
asyncio.run(main())
PY
