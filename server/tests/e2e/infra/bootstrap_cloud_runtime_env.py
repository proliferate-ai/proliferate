from __future__ import annotations

import argparse
import asyncio
import json
import sys
from typing import Any

import httpx

from proliferate.db import engine as engine_module
from tests.e2e.cloud.helpers import (
    CloudE2ETestError,
    create_user_and_login,
    link_github_account,
    load_cloud_test_config,
    sync_cloud_credential,
)


async def _bootstrap_runtime_env(args: argparse.Namespace) -> dict[str, Any]:
    config = load_cloud_test_config()
    if not config.github_token:
        raise CloudE2ETestError("GH_TOKEN or a local gh auth token is required.")

    async with (
        engine_module.async_session_factory() as db_session,
        httpx.AsyncClient(base_url=args.base_url, timeout=60.0) as client,
    ):
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix=args.email_prefix,
        )
        await link_github_account(
            db_session,
            user_id=auth.user_id,
            access_token=config.github_token,
        )
        repo_config_response = await client.put(
            f"/v1/cloud/repos/{args.git_owner}/{args.git_repo}/config",
            headers=auth.headers,
            json={
                "configured": True,
                "defaultBranch": args.base_branch,
                "envVars": {},
                "setupScript": "",
                "files": [],
            },
        )
        repo_config_response.raise_for_status()

        selected_providers = args.sync_provider or ["claude"]
        synced_providers: list[str] = []
        for provider in selected_providers:
            try:
                await sync_cloud_credential(client, auth, config, provider)
            except CloudE2ETestError:
                continue
            synced_providers.append(provider)

    if not synced_providers:
        raise CloudE2ETestError(
            "No cloud agent credentials were available to seed the runtime suite."
        )

    return {
        "PROLIFERATE_CLOUD_BASE_URL": args.base_url,
        "PROLIFERATE_CLOUD_ACCESS_TOKEN": auth.access_token,
        "PROLIFERATE_CLOUD_GIT_OWNER": args.git_owner,
        "PROLIFERATE_CLOUD_GIT_REPO": args.git_repo,
        "PROLIFERATE_CLOUD_BASE_BRANCH": args.base_branch,
        "PROLIFERATE_CLOUD_BRANCH_PREFIX": args.branch_prefix,
        "PROLIFERATE_CLOUD_PROVIDER": args.provider,
        "PROLIFERATE_CLOUD_SYNCED_PROVIDERS": ",".join(synced_providers),
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Bootstrap cloud auth/context env for the shared AnyHarness cloud runtime suite."
        )
    )
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--provider", required=True, choices=("e2b", "daytona"))
    parser.add_argument("--git-owner", required=True)
    parser.add_argument("--git-repo", required=True)
    parser.add_argument("--base-branch", required=True)
    parser.add_argument("--branch-prefix", required=True)
    parser.add_argument("--email-prefix", required=True)
    parser.add_argument(
        "--sync-provider",
        action="append",
        choices=("claude", "codex", "gemini"),
        default=None,
        help=(
            "Cloud agent credential to sync before creating the runtime "
            "bridge. Defaults to claude."
        ),
    )
    return parser


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()
    try:
        payload = asyncio.run(_bootstrap_runtime_env(args))
    except CloudE2ETestError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(json.dumps(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
