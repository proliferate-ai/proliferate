"""Direct E2B verification/action backdoor for T3-PROV-2 and T3-SEC-MAT-1.

Ground truth (surveyed 2026-07-09, see specs/developing/testing/scenarios.md
#T3-PROV-2 / #T3-SEC-MAT-1): the product API never exposes a cloud sandbox's
provider (E2B) sandbox id -- see
server/proliferate/server/cloud/cloud_sandboxes/models.py, which serializes
only the internal `cloud_sandbox.id` -- and there is NO product-level pause
endpoint at all. A sandbox only pauses via E2B's own idle-timeout lifecycle
(`lifecycle={"on_timeout": "pause", "auto_resume": True}`, set at
`Sandbox.create()` time in
server/proliferate/integrations/sandbox/e2b.py:_create_sandbox) or via the
product's own reconciler pausing an over-budget sandbox
(server/proliferate/server/cloud/webhooks/service.py calls
`provider.pause_sandbox`). Pablo has authorized direct use of the E2B API key
for VERIFICATION of ground truth, and -- since no product lever exists at
all -- for driving the pause action itself in T3-PROV-2.

No database access is needed to resolve the provider sandbox id: every
personal cloud sandbox the product creates is tagged with
`metadata={"proliferate_cloud_sandbox_id": str(sandbox.id)}`
(server/proliferate/server/cloud/materialization/sandbox_io/connect.py) --
the exact same id the product API returns as `GET /v1/cloud/cloud-sandbox`'s
`id` field. So this script finds the provider sandbox purely via E2B's own
sandbox-list API, filtered by that metadata key -- it never touches Postgres,
which matters most for the staging lane (its DB is VPC-only).

Subcommands, one JSON object printed to stdout each:
  find <cloud_sandbox_id>                  -> {"providerSandboxId": str|null, "state": str|null}
  state <provider_sandbox_id>              -> {"state": str}
  pause <provider_sandbox_id>              -> {"paused": bool}
  exec <provider_sandbox_id> <command...>  -> {"stdout": str, "stderr": str, "exitCode": int}
  write <provider_sandbox_id> <path>       -> {"written": bool} (content read from stdin)
  read <provider_sandbox_id> <path>        -> {"content": str|null, "error": str|null}

Requires E2B_API_KEY in the environment (the TS caller maps it from
RELEASE_E2E_E2B_API_KEY -- see ../src/fixtures/e2b-verify.ts). This script
never prints the key.
"""

from __future__ import annotations

import argparse
import json
import os
import sys


def _api_key() -> str:
    key = os.environ.get("E2B_API_KEY")
    if not key:
        print(json.dumps({"error": "E2B_API_KEY not set in this script's environment"}))
        sys.exit(1)
    return key


def _state_name(value: object) -> str:
    return str(getattr(value, "value", value))


def cmd_find(cloud_sandbox_id: str) -> dict[str, object]:
    from e2b import Sandbox
    from e2b.api.client.models.sandbox_state import SandboxState
    from e2b.sandbox.sandbox_api import SandboxQuery

    api_key = _api_key()
    paginator = Sandbox.list(
        query=SandboxQuery(
            metadata={"proliferate_cloud_sandbox_id": cloud_sandbox_id},
            state=[SandboxState.RUNNING, SandboxState.PAUSED],
        ),
        api_key=api_key,
    )
    items = paginator.next_items()
    if not items:
        return {"providerSandboxId": None, "state": None}
    # One cloud_sandbox row maps to at most one live provider sandbox at a time.
    info = items[0]
    return {"providerSandboxId": info.sandbox_id, "state": _state_name(info.state)}


def cmd_state(provider_sandbox_id: str) -> dict[str, object]:
    from e2b import Sandbox

    api_key = _api_key()
    info = Sandbox.get_info(provider_sandbox_id, api_key=api_key)
    return {"state": _state_name(info.state)}


def cmd_pause(provider_sandbox_id: str) -> dict[str, object]:
    from e2b import Sandbox

    api_key = _api_key()
    result = Sandbox.pause(provider_sandbox_id, api_key=api_key)
    return {"paused": bool(result)}


def cmd_exec(provider_sandbox_id: str, command: list[str]) -> dict[str, object]:
    from e2b import Sandbox

    api_key = _api_key()
    sbx = Sandbox.connect(provider_sandbox_id, api_key=api_key)
    result = sbx.commands.run(" ".join(command))
    return {
        "stdout": result.stdout,
        "stderr": result.stderr,
        "exitCode": result.exit_code,
    }


def cmd_write(provider_sandbox_id: str, path: str, content: str) -> dict[str, object]:
    from e2b import Sandbox

    api_key = _api_key()
    sbx = Sandbox.connect(provider_sandbox_id, api_key=api_key)
    sbx.files.write(path, content)
    return {"written": True}


def cmd_read(provider_sandbox_id: str, path: str) -> dict[str, object]:
    from e2b import Sandbox

    api_key = _api_key()
    sbx = Sandbox.connect(provider_sandbox_id, api_key=api_key)
    try:
        content = sbx.files.read(path)
        return {"content": content, "error": None}
    except Exception as exc:  # noqa: BLE001 - a missing file is an expected, reportable outcome, not a crash.
        return {"content": None, "error": str(exc)[:500]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    # dest="action" (not "command") -- the exec subparser below also needs an
    # argument literally named "command" (the argv to run), which would
    # collide with argparse's subparsers dest of the same name.
    sub = parser.add_subparsers(dest="action", required=True)

    p_find = sub.add_parser("find")
    p_find.add_argument("cloud_sandbox_id")

    p_state = sub.add_parser("state")
    p_state.add_argument("provider_sandbox_id")

    p_pause = sub.add_parser("pause")
    p_pause.add_argument("provider_sandbox_id")

    p_exec = sub.add_parser("exec")
    p_exec.add_argument("provider_sandbox_id")
    p_exec.add_argument("command", nargs="+")

    p_write = sub.add_parser("write")
    p_write.add_argument("provider_sandbox_id")
    p_write.add_argument("path")
    p_write.add_argument(
        "--content-stdin",
        action="store_true",
        help="Read file content from stdin instead of an argv value (avoids leaking test values into process listings).",
    )
    p_write.add_argument("content", nargs="?")

    p_read = sub.add_parser("read")
    p_read.add_argument("provider_sandbox_id")
    p_read.add_argument("path")

    args = parser.parse_args()

    if args.action == "find":
        result = cmd_find(args.cloud_sandbox_id)
    elif args.action == "state":
        result = cmd_state(args.provider_sandbox_id)
    elif args.action == "pause":
        result = cmd_pause(args.provider_sandbox_id)
    elif args.action == "exec":
        result = cmd_exec(args.provider_sandbox_id, args.command)
    elif args.action == "write":
        content = sys.stdin.read() if args.content_stdin else (args.content or "")
        result = cmd_write(args.provider_sandbox_id, args.path, content)
    elif args.action == "read":
        result = cmd_read(args.provider_sandbox_id, args.path)
    else:  # pragma: no cover - argparse enforces the choice set above.
        raise AssertionError(f"unknown action {args.action!r}")

    print(json.dumps(result))


if __name__ == "__main__":
    main()
