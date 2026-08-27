#!/bin/bash
# One-command recovery for the staging battery's durable-user credential
# (delivery/testing-cicd/delivery-spec-e2e-observable.md, "Rotation write-back").
#
# The runner self-rotates the durable staging user's refresh token and CI
# persists the rotated state in the Actions cache between runs. When that
# chain breaks — cache evicted after long idleness AND the bootstrap secret
# already consumed, or the user's token_generation bumped — the staging lane
# reports `blocked` in the digest, and this script is the fix:
#
#   1. mint a fresh session in-VPC (the staging DB is VPC-only) by piping
#      staging_session_seed.py into a one-off ECS task on the staging server
#      image (no image rebuild, no product change — the seed's own recipe);
#   2. rotate it ONCE through the public refresh route to prove the chain;
#   3. store the ROTATED token as the `staging` environment secret.
#
# The token never reaches stdout, a log, or a persistent file: it lives in a
# mode-600 temp dir removed on exit. Needs: aws (staging account), gh (repo
# admin for `gh secret set`), python3. Operator-run only. Staging-only.
#
# Usage: tests/release/scripts/staging-session-remint.sh [durable-user-login]
set -euo pipefail

CLUSTER=${STAGING_ECS_CLUSTER:-proliferate-staging}
SERVICE=${STAGING_ECS_SERVER_SERVICE:-proliferate-staging-server}
API_BASE_URL=${STAGING_API_BASE_URL:-https://staging-app.proliferate.com/api}
REPO=${GITHUB_REPOSITORY:-proliferate-ai/proliferate}
SECRET_NAME=RELEASE_E2E_STAGING_SESSION_REFRESH_TOKEN
DURABLE_USER=${1:-proliferate-e2e-bot}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

WORK=$(mktemp -d "${TMPDIR:-/tmp}/staging-remint.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
umask 077

echo "==> resolving the staging server task definition + network"
TASK_DEF=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
  --query 'services[0].taskDefinition' --output text)
NETWORK=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
  --query 'services[0].networkConfiguration.awsvpcConfiguration' --output json)
CONTAINER=$(aws ecs describe-task-definition --task-definition "$TASK_DEF" \
  --query 'taskDefinition.containerDefinitions[0].name' --output text)
LOG_GROUP=$(aws ecs describe-task-definition --task-definition "$TASK_DEF" \
  --query 'taskDefinition.containerDefinitions[0].logConfiguration.options."awslogs-group"' --output text)
LOG_PREFIX=$(aws ecs describe-task-definition --task-definition "$TASK_DEF" \
  --query 'taskDefinition.containerDefinitions[0].logConfiguration.options."awslogs-stream-prefix"' --output text)

# The seed script minus its module docstring: ECS overrides are capped at 8 KB.
python3 - "$HERE/staging_session_seed.py" "$CONTAINER" "$DURABLE_USER" <<'PY' > "$WORK/overrides.json"
import json, pathlib, re, sys
src = pathlib.Path(sys.argv[1]).read_text()
stripped = re.sub(r'^"""[\s\S]*?"""\n', "", src, count=1)
print(json.dumps({"containerOverrides": [{"name": sys.argv[2],
    "command": ["python3", "-c", stripped, "mint", sys.argv[3]]}]}))
PY

python3 - "$NETWORK" <<'PY' > "$WORK/network.txt"
import json, sys
net = json.loads(sys.argv[1])
print("awsvpcConfiguration={subnets=[%s],securityGroups=[%s],assignPublicIp=%s}" % (
    ",".join(net["subnets"]), ",".join(net["securityGroups"]), net.get("assignPublicIp", "ENABLED")))
PY

echo "==> minting in-VPC (one-off task on $TASK_DEF)"
TASK_ARN=$(aws ecs run-task --cluster "$CLUSTER" --task-definition "$TASK_DEF" --launch-type FARGATE \
  --network-configuration "$(cat "$WORK/network.txt")" --overrides "file://$WORK/overrides.json" \
  --query 'tasks[0].taskArn' --output text)
TASK_ID=${TASK_ARN##*/}
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK_ARN"
EXIT_CODE=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" \
  --query 'tasks[0].containers[0].exitCode' --output text)
echo "    task $TASK_ID exited $EXIT_CODE"

aws logs get-log-events --log-group-name "$LOG_GROUP" --log-stream-name "$LOG_PREFIX/$CONTAINER/$TASK_ID" \
  --start-from-head --query 'events[].message' --output json > "$WORK/events.json"

python3 - "$WORK" <<'PY'
import json, pathlib, sys
work = pathlib.Path(sys.argv[1])
payload = None
for message in json.loads((work / "events.json").read_text()):
    line = message.strip()
    if line.startswith("{") and "refreshToken" in line:
        payload = json.loads(line)
if payload is None or payload.get("error"):
    raise SystemExit(f"mint failed: {payload.get('error') if payload else 'no mint JSON in task logs'}")
(work / "t0").write_text(payload["refreshToken"])
print(f"    minted for {payload.get('githubLogin')} ({payload.get('email')})")
PY

echo "==> rotating once through $API_BASE_URL/auth/mobile/session/refresh"
python3 - "$WORK" "$API_BASE_URL" <<'PY'
import json, pathlib, sys, urllib.request
work, base = pathlib.Path(sys.argv[1]), sys.argv[2]
req = urllib.request.Request(f"{base}/auth/mobile/session/refresh",
    data=json.dumps({"refreshToken": (work / "t0").read_text().strip()}).encode(),
    headers={"Content-Type": "application/json"}, method="POST")
with urllib.request.urlopen(req, timeout=30) as resp:
    body = json.loads(resp.read())
if not body.get("refreshToken"):
    raise SystemExit(f"rotate failed: keys={list(body)}")
(work / "t1").write_text(body["refreshToken"])
print("    rotation ok")
PY

echo "==> storing the rotated token as the staging environment secret $SECRET_NAME"
gh secret set "$SECRET_NAME" --env staging --repo "$REPO" --body "$(cat "$WORK/t1")"
echo "==> done. Do NOT rotate this token by hand — the next CI run consumes it and the cache carries on."
