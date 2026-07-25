#!/usr/bin/env bash
# Show the worker/enrollment/gateway-token/account state + the dotfile.
set -euo pipefail
PROFILE="${PROFILE:-igtest}"
LAUNCH_ENV="$HOME/.proliferate-local/dev/profiles/$PROFILE/launch.env"
cd "$(dirname "$0")/server"
set -a; . "$LAUNCH_ENV"; set +a
echo "=== DB state ==="
uv run python - <<'PY'
import asyncio, os
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
async def main():
    eng = create_async_engine(os.environ["DATABASE_URL"])
    async with eng.connect() as c:
        for q in ["select runtime_kind,status,desktop_install_id from cloud_runtime_worker",
                  "select status from cloud_runtime_worker_enrollment",
                  "select status, last_used_at is not null used from cloud_integration_gateway_token",
                  "select namespace, status from cloud_integration_account a join cloud_integration_definition d on a.definition_id=d.id"]:
            rows=(await c.execute(text(q))).fetchall()
            print(" ", q.split("from")[1].strip().split()[0], "->", [tuple(r) for r in rows])
    await eng.dispose()
asyncio.run(main())
PY
echo "=== dotfile ==="
DOTFILE="$HOME/.proliferate-local/anyharness/integration-gateway.json"
[ -f "$DOTFILE" ] && { echo "$DOTFILE:"; cat "$DOTFILE"; } || echo "no dotfile yet at $DOTFILE (sign in first)"
