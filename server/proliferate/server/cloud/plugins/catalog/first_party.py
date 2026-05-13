from __future__ import annotations

from dataclasses import asdict, replace
import hashlib
import json

from proliferate.server.cloud.mcp_catalog.domain.types import CatalogEntry
from proliferate.server.cloud.plugins.catalog.domain.types import PluginPackage, PluginSkill
from proliferate.server.cloud.plugins.catalog.provenance import adapted_skill


OPENAI_PLUGINS_REPO = "https://github.com/openai/plugins"
OPENAI_PLUGINS_SOURCE_REF = "7955f1db081ddb3e14387b27cd65cf96b3e33931"


def first_party_package_for_catalog_entry(entry: CatalogEntry) -> PluginPackage:
    skills = _FIRST_PARTY_SKILLS_BY_CATALOG_ENTRY_ID.get(entry.id, ())
    package = PluginPackage(
        id=entry.id,
        catalog_entry_id=entry.id,
        version="",
        display_name=entry.name,
        description=entry.description,
        skills=skills,
    )
    return replace(package, version=_package_version(entry.version, package))


def _package_version(connector_version: int, package: PluginPackage) -> str:
    payload = asdict(package)
    payload["version"] = ""
    digest = hashlib.sha256()
    digest.update(
        json.dumps(
            payload,
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    )
    return f"{connector_version}+{digest.hexdigest()[:12]}"


def _skill(
    *,
    catalog_entry_id: str,
    id: str,
    display_name: str,
    description: str,
    relative_path: str,
    source_path: str,
    source_sha256: str,
    source_license: str,
    source_ref: str = OPENAI_PLUGINS_SOURCE_REF,
    notes: str = "",
) -> PluginSkill:
    return adapted_skill(
        id=id,
        display_name=display_name,
        description=description,
        relative_path=relative_path,
        required_mcp_server_refs=(catalog_entry_id,),
        source_repo_url=OPENAI_PLUGINS_REPO,
        source_path=source_path,
        source_ref=source_ref,
        source_sha256=source_sha256,
        source_license=source_license,
        notes=notes,
    )


_FIRST_PARTY_SKILLS_BY_CATALOG_ENTRY_ID: dict[str, tuple[PluginSkill, ...]] = {
    "github": (
        _skill(
            catalog_entry_id="github",
            id="triage",
            display_name="GitHub triage",
            description="Inspect repositories, issues, pull requests, and checks before taking action.",
            relative_path="github/triage.md",
            source_path="plugins/github/skills/github/SKILL.md",
            source_sha256="81dbdd90934fe86a79ddc4790fd211e5fca866302a74090ad153395f56f2bd42",
            source_license="MIT",
            notes="Router rewritten to exclude Codex publish/yeet flows.",
        ),
        _skill(
            catalog_entry_id="github",
            id="address-comments",
            display_name="Address PR comments",
            description="Review unresolved PR feedback and plan changes against the current branch.",
            relative_path="github/address-comments.md",
            source_path="plugins/github/skills/gh-address-comments/SKILL.md",
            source_sha256="c1ebc337357402f7faabafe712e0c463981a65f736453efe52abd305bcb74769",
            source_license="MIT",
        ),
        _skill(
            catalog_entry_id="github",
            id="fix-ci",
            display_name="Fix GitHub CI",
            description="Inspect failing GitHub Actions checks and isolate likely fixes.",
            relative_path="github/fix-ci.md",
            source_path="plugins/github/skills/gh-fix-ci/SKILL.md",
            source_sha256="7621a3560d788fb221d25f9753233fe0c393c5cfe63167c88b11f027c277b1f8",
            source_license="MIT",
        ),
    ),
    "linear": (
        _skill(
            catalog_entry_id="linear",
            id="issue-triage",
            display_name="Linear issue triage",
            description="Search, inspect, and summarize Linear work before editing issues.",
            relative_path="linear/issue-triage.md",
            source_path="plugins/linear/skills/linear/SKILL.md",
            source_sha256="8a409240f8f9f70363550340b66ff31377b638d25e780e081546248ed417c6dc",
            source_license="MIT",
            notes="Adapted to read-first behavior; mutation guidance requires explicit user intent.",
        ),
    ),
    "slack": (
        _skill(
            catalog_entry_id="slack",
            id="context",
            display_name="Slack context lookup",
            description="Find relevant Slack channels, threads, and messages for a task.",
            relative_path="slack/context-lookup.md",
            source_path="plugins/slack/skills/slack/SKILL.md",
            source_sha256="e9ce0c0f26ab433e32883401ae65732582fd0d0fb17ce9eafd5302673f0b9df3",
            source_license="MIT",
            notes="Send, schedule, and canvas operations removed from default guidance.",
        ),
        _skill(
            catalog_entry_id="slack",
            id="channel-summary",
            display_name="Slack channel summary",
            description="Summarize channel or thread activity with citations to the source messages.",
            relative_path="slack/channel-summary.md",
            source_path="plugins/slack/skills/slack-channel-summarization/SKILL.md",
            source_sha256="e4c87663ca8c12e3df530963b5f1e6669e9b8e2ec551f02152fb8f410bdb92de",
            source_license="MIT",
        ),
        _skill(
            catalog_entry_id="slack",
            id="reply-drafting",
            display_name="Slack reply drafting",
            description="Draft replies from Slack context without sending unless the user asks.",
            relative_path="slack/reply-drafting.md",
            source_path="plugins/slack/skills/slack-reply-drafting/SKILL.md",
            source_sha256="8c37e767de5973748208a3226395b849c2e48ae04b5d74d67bdf74cbddde31d1",
            source_license="MIT",
        ),
    ),
    "notion": (
        _skill(
            catalog_entry_id="notion",
            id="knowledge-capture",
            display_name="Notion knowledge capture",
            description="Turn research or session outcomes into structured Notion notes.",
            relative_path="notion/knowledge-capture.md",
            source_path="plugins/notion/skills/notion-knowledge-capture/SKILL.md",
            source_sha256="5c41d55314e25ebf5b4eee549d16531d42baf292171681d893f9f973160bbb6c",
            source_license="MIT",
        ),
        _skill(
            catalog_entry_id="notion",
            id="research-documentation",
            display_name="Notion research documentation",
            description="Organize research findings into Notion pages with source-backed sections.",
            relative_path="notion/research-documentation.md",
            source_path="plugins/notion/skills/notion-research-documentation/SKILL.md",
            source_sha256="0e6377705bcac9166a1df6bb96b1f1417d15f89be561b80a421d9208f50d1bad",
            source_license="MIT",
        ),
        _skill(
            catalog_entry_id="notion",
            id="spec-to-implementation",
            display_name="Notion spec to implementation",
            description="Use Notion specs as implementation context and keep derived tasks traceable.",
            relative_path="notion/spec-to-implementation.md",
            source_path="plugins/notion/skills/notion-spec-to-implementation/SKILL.md",
            source_sha256="4d60e6d384ca631f13b19d83dedde864f4eb92b12c6955d54ad434b0f0a7011a",
            source_license="MIT",
        ),
    ),
    "supabase": (
        _skill(
            catalog_entry_id="supabase",
            id="project-inspection",
            display_name="Supabase project inspection",
            description="Inspect the configured Supabase project safely with read-only defaults.",
            relative_path="supabase/project-inspection.md",
            source_path="plugins/supabase/skills/supabase/SKILL.md",
            source_sha256="41f4694e5e8114215fb2c4b1b72f373dddec52eb784ec92ed8d8a6885cb0f197",
            source_license="MIT",
            notes="Defaults to the selected projectRef and readOnly setting.",
        ),
        _skill(
            catalog_entry_id="supabase",
            id="postgres-best-practices",
            display_name="Supabase Postgres best practices",
            description="Review schema, query, and migration work against Supabase Postgres practices.",
            relative_path="supabase/postgres-best-practices.md",
            source_path="plugins/supabase/skills/supabase-postgres-best-practices/SKILL.md",
            source_sha256="ccd6e4596bd51cf344fe76c464867c541ccc16b6d90ae7a9db449fb17588613b",
            source_license="MIT",
        ),
    ),
    "render": (
        _skill(
            catalog_entry_id="render",
            id="debug",
            display_name="Render debug",
            description="Inspect Render service state, events, logs, and likely deployment issues.",
            relative_path="render/debug.md",
            source_path="plugins/render/skills/render-debug/SKILL.md",
            source_sha256="72268428eec2917201c224f3c1045369ea3575b41b94ff0c896a066f8b643c43",
            source_license="MIT",
            notes="Codex setup and deploy flows removed from default guidance.",
        ),
        _skill(
            catalog_entry_id="render",
            id="monitor",
            display_name="Render monitor",
            description="Summarize Render service health and recent incidents from available data.",
            relative_path="render/monitor.md",
            source_path="plugins/render/skills/render-monitor/SKILL.md",
            source_sha256="b8ca61fb72d95bde1ce438939b14310a4b6cebebddcc2e74cdc6ae9cd93a0f8f",
            source_license="MIT",
        ),
    ),
    "huggingface": (
        _skill(
            catalog_entry_id="huggingface",
            id="datasets",
            display_name="Hugging Face datasets",
            description="Inspect Hugging Face dataset metadata, splits, rows, and viewer results.",
            relative_path="huggingface/datasets.md",
            source_path="plugins/hugging-face/skills/datasets/SKILL.md",
            source_sha256="5af74f3e042313efadf02e85c316a2576bdc0b0ff92c43c3ba5dcb6e2dae1ded",
            source_license="MIT",
        ),
        _skill(
            catalog_entry_id="huggingface",
            id="papers",
            display_name="Hugging Face papers",
            description="Look up, summarize, and cross-reference Hugging Face paper pages.",
            relative_path="huggingface/papers.md",
            source_path="plugins/hugging-face/skills/papers/SKILL.md",
            source_sha256="985c2d5c7261aba2b157811cde0c2b30134663694a4ab701280de28f941eb3b2",
            source_license="MIT",
        ),
    ),
    "cloudflare_docs": (
        _skill(
            catalog_entry_id="cloudflare_docs",
            id="docs-research",
            display_name="Cloudflare docs research",
            description="Use Cloudflare Docs as retrieval context without issuing platform mutations.",
            relative_path="cloudflare/docs-research.md",
            source_path="plugins/cloudflare/skills/cloudflare/SKILL.md",
            source_sha256="613c4c57c19bd6385a870b4d441e00a0d88cc6c348c447f8a88889d34b17b2d0",
            source_license="MIT",
            notes="Narrowed from platform control to documentation lookup.",
        ),
    ),
    "neon": (
        _skill(
            catalog_entry_id="neon",
            id="readonly-inspection",
            display_name="Neon read-only inspection",
            description="Inspect Neon Postgres context using the hosted read-only MCP assumptions.",
            relative_path="neon/readonly-inspection.md",
            source_path="plugins/neon-postgres/skills/neon-postgres/SKILL.md",
            source_sha256="102b4b2d25ab50aa8355f06792ee7828655af05a55be419744099b1dc8dc5fa3",
            source_license="Apache-2.0",
            notes="Adapted to hosted read-only header assumptions.",
        ),
    ),
    "gmail": (
        _skill(
            catalog_entry_id="gmail",
            id="readonly",
            display_name="Gmail read-only lookup",
            description="Search, read, and summarize Gmail without modifying mailbox state.",
            relative_path="gmail/readonly.md",
            source_path="plugins/gmail/skills/gmail/SKILL.md",
            source_sha256="d3eee36dc69ba2fb8388018df122d5f53e4a807c373067edad8d3df1c588f6e4",
            source_license="MIT",
            notes="Send, archive, delete, and label operations removed because Proliferate launches Gmail as read-only.",
        ),
        _skill(
            catalog_entry_id="gmail",
            id="inbox-triage",
            display_name="Gmail inbox triage",
            description="Summarize and prioritize email threads without changing them.",
            relative_path="gmail/inbox-triage.md",
            source_path="plugins/gmail/skills/gmail-inbox-triage/SKILL.md",
            source_sha256="1ce1ef20bbe99da3e824818e397e50c33238666e528fed8e9ec46250585ec5cc",
            source_license="MIT",
        ),
    ),
}
