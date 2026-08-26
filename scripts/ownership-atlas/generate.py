#!/usr/bin/env python3
"""Generate the Ownership Atlas.

The atlas is a single self-contained HTML page: which spec system owns
each region of the Proliferate codebase, sized by lines of code and
colored by the six-role model (atom · doors · keys · windows · body ·
keepers · engineering · place · areas). It exists to make coverage
debt visible — unowned regions and unresolved splits are the gap.

Run it with no arguments to regenerate `ownership-atlas.html` next to
this script:

    python3 scripts/ownership-atlas/generate.py

Pass a path to write elsewhere:

    python3 scripts/ownership-atlas/generate.py /tmp/atlas.html

To refresh after a ruling lands or a wave executes: edit the OWNERSHIP
table below (the census walk and the HTML/CSS/JS never need to change
for that), then re-run the command above and paste the resulting file
to Claude to republish the shared page.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path

# --------------------------------------------------------------------------
# Census parameters. These must stay identical to how the rest of the
# repo's tooling counts lines: same extensions, same skip dirs. Changing
# them changes every LOC number on the page.
# --------------------------------------------------------------------------
EXTENSIONS = {
    ".py", ".rs", ".ts", ".tsx", ".js", ".jsx",
    ".toml", ".yaml", ".yml", ".sql", ".sh", ".mjs",
}
SKIP_DIRS = {"node_modules", ".venv", "__pycache__", "target", "dist", "build", ".git", "generated"}


def count_loc(path: Path) -> int:
    """Count lines across census-eligible files under `path`."""
    total = 0
    for dirpath, dirnames, filenames in os.walk(path):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            if os.path.splitext(name)[1] in EXTENSIONS:
                try:
                    with open(os.path.join(dirpath, name), "rb") as fh:
                        total += sum(1 for _ in fh)
                except OSError:
                    pass
    return total


@dataclass(frozen=True)
class Region:
    rel_path: str  # repo-relative path the census walks for LOC
    display: str  # "p" in the page's data — the label shown on the page
    spec: str  # "s" — owning spec, or a compound/prose description when split
    role: str  # "r" — one of the nine legend roles (or "" when unowned)
    status: str  # "st" — "owned" / "shared" / "unowned"; see note below
    note: str  # "n" — the blocking ruling / split / migration note
    leg: str  # which of the four census legs (server / runtime / clients / plumbing)


# ==========================================================================
# OWNERSHIP — the thing to edit when a ruling lands or a wave executes.
#
# One row per region of the codebase. `rel_path` is what gets walked for
# LOC; everything else is asserted, not derived — there is no MANIFEST.toml
# schema for role/status/note, so this table *is* the ruling record for
# regions outside server/proliferate/server (whose MANIFEST.toml is the
# machine truth for which directories are domains at all, even though the
# spec/role/status/note below are still hand-maintained here).
#
# `status` is normally "owned" / "shared" / "unowned". A few rows below
# carry "" or a stray note-shaped string in that slot instead — that is
# inherited verbatim from the page's last hand-authored revision (a status
# left blank, or a "note" that landed in the status slot instead of the
# note slot). Both fold into the "owned" bucket in the stats bar, same as
# "owned" does. Preserved on purpose: fixing the shape here would change
# the page's rendering out from under a wave that hasn't touched those
# rows, and would make this file a worse diff base for the next person
# who edits it. Fix a row's shape only when you are already changing its
# ownership for a real reason.
# ==========================================================================

OWNERSHIP: list[Region] = [
    # ---- Server — control plane (Python) ----
    Region("server/proliferate/server/accounts", "server/accounts", "identity", "keepers", "owned", "", "Server — control plane (Python)"),
    Region("server/proliferate/server/organizations", "server/organizations", "identity", "keepers", "owned", "", "Server — control plane (Python)"),
    Region("server/proliferate/server/setup", "server/setup", "identity", "keepers", "owned", "", "Server — control plane (Python)"),
    Region("server/proliferate/server/billing", "server/billing", "billing", "keepers", "owned", "", "Server — control plane (Python)"),
    Region("server/proliferate/server/support", "server/support", "support", "keepers", "owned", "", "Server — control plane (Python)"),
    Region("server/proliferate/server/agent_auth", "server/agent_auth", "agent_auth ∧ ai_gateway", "keys", "shared", "9 files ⇒ ai_gateway; code split on the build list", "Server — control plane (Python)"),
    Region("server/proliferate/server/ai_magic", "server/ai_magic", "ai_gateway", "keys", "owned", "", "Server — control plane (Python)"),
    Region("server/proliferate/server/integration_gateway", "server/integration_gateway", "integration_gateway", "keys", "owned", "", "Server — control plane (Python)"),
    Region("server/proliferate/server/github", "server/github", "github", "keys", "owned", "", "Server — control plane (Python)"),
    Region("server/proliferate/server/repositories", "server/repositories", "github", "keys", "owned", "⇒ folds into github", "Server — control plane (Python)"),
    Region("server/proliferate/server/workflows", "server/workflows", "automations", "doors", "owned", "⇒ automations/", "Server — control plane (Python)"),
    Region("server/proliferate/server/seam", "server/seam", "environments", "place", "owned", "", "Server — control plane (Python)"),
    Region("server/proliferate/server/cloud", "server/cloud", "— held", "", "unowned", "gateway proxy, dark; keep-vs-delete ruling pending", "Server — control plane (Python)"),
    Region("server/proliferate/server/catalogs", "server/catalogs", "harnesses", "body", "owned", "", "Server — control plane (Python)"),
    Region("server/proliferate/server/artifact_runtime", "server/artifact_runtime", "sessions", "atom", "owned", "", "Server — control plane (Python)"),
    Region("server/proliferate/server/analytics", "server/analytics", "engineering/observability", "engineering", "owned", "", "Server — control plane (Python)"),
    Region("server/proliferate/server/anonymous_telemetry", "server/anonymous_telemetry", "engineering/observability", "engineering", "owned", "", "Server — control plane (Python)"),
    Region("server/proliferate/server/devtools", "server/devtools", "engineering/shipping", "engineering", "owned", "", "Server — control plane (Python)"),
    # ---- Runtime — AnyHarness (Rust) ----
    Region("anyharness/crates/anyharness-lib/src/domains/sessions", "domains/sessions", "sessions", "atom", "owned", "", "Runtime — AnyHarness (Rust)"),
    Region("anyharness/crates/anyharness-lib/src/live", "live/", "sessions", "atom", "", "", "Runtime — AnyHarness (Rust)"),
    Region("anyharness/crates/anyharness-lib/src/domains/artifacts", "domains/artifacts", "sessions", "atom", "owned", "", "Runtime — AnyHarness (Rust)"),
    Region("anyharness/crates/anyharness-lib/src/domains/activity", "domains/activity", "sessions (observers)", "atom", "owned", "", "Runtime — AnyHarness (Rust)"),
    Region("anyharness/crates/anyharness-lib/src/domains/goals", "domains/goals", "sessions (observers)", "atom", "owned", "", "Runtime — AnyHarness (Rust)"),
    Region("anyharness/crates/anyharness-lib/src/domains/loops", "domains/loops", "sessions (observers)", "atom", "owned", "", "Runtime — AnyHarness (Rust)"),
    Region("anyharness/crates/anyharness-lib/src/domains/agents", "domains/agents", "harnesses ∧ agent_auth", "body", "shared", "route_auth · auth · auth_state · launch_probe are agent_auth's; Wave-3 move ruled", "Runtime — AnyHarness (Rust)"),
    Region("anyharness/crates/anyharness-lib/src/adapters", "adapters/", "machinery: mechanism adapters — git · files · processes · hosting (an adapter with an opinion is a bug; multi-consumer, NOT harnesses')", "areas", "owned", "", "Runtime — AnyHarness (Rust)"),
    Region("anyharness/crates/anyharness-lib/src/domains/agent_operations", "domains/agent_operations", "subagents", "body", "", "", "Runtime — AnyHarness (Rust)"),
    Region("anyharness/crates/anyharness-lib/src/domains/cowork", "domains/cowork", "subagents", "body", "⇒ folds into subagents", "", "Runtime — AnyHarness (Rust)"),
    Region("anyharness/crates/anyharness-lib/src/domains/workspaces", "domains/workspaces", "workspaces", "body", "owned", "", "Runtime — AnyHarness (Rust)"),
    Region("anyharness/crates/anyharness-lib/src/domains/repo_roots", "domains/repo_roots", "workspaces", "body", "⇒ folds in", "", "Runtime — AnyHarness (Rust)"),
    Region("anyharness/crates/anyharness-lib/src/domains/terminals", "domains/terminals", "workspaces", "body", "owned", "", "Runtime — AnyHarness (Rust)"),
    Region("anyharness/crates/anyharness-lib/src/domains/workflows", "domains/workflows", "automations", "doors", "owned", "", "Runtime — AnyHarness (Rust)"),
    Region("anyharness/crates/anyharness-lib/src/api", "api/ (http · sse · ws)", "each route file → its domain's spec (sessions, harnesses, agent_auth, …)", "areas", "shared", "multi-owner by rule, permanently — what it awaits is an enforcement checker, not a code move", "Runtime — AnyHarness (Rust)"),
    Region("anyharness/crates/anyharness-lib/src/domains/materialization", "domains/materialization", "—", "", "unowned", "owner TBD in harnesses/subagents pass", "Runtime — AnyHarness (Rust)"),
    Region("anyharness/crates/anyharness-lib/src/domains/plans", "domains/plans", "—", "", "unowned", "owner TBD in harnesses/subagents pass", "Runtime — AnyHarness (Rust)"),
    Region("anyharness/crates/anyharness-lib/src/domains/reviews", "domains/reviews", "—", "", "unowned", "one-review-system ruling pending", "Runtime — AnyHarness (Rust)"),
    Region("anyharness/crates/anyharness-lib/src/domains/mobility", "domains/mobility", "—", "", "unowned", "cull-listed", "Runtime — AnyHarness (Rust)"),
    Region("anyharness/crates/anyharness-lib/src/app", "app/", "machinery: wiring (areas/anyharness)", "areas", "owned", "", "Runtime — AnyHarness (Rust)"),
    Region("anyharness/crates/anyharness-lib/src/persistence", "persistence/", "machinery: SQLite layer (areas/anyharness)", "areas", "owned", "", "Runtime — AnyHarness (Rust)"),
    Region("anyharness/crates/anyharness-lib/src/observability", "observability/", "machinery: telemetry plumbing (areas/anyharness)", "areas", "owned", "", "Runtime — AnyHarness (Rust)"),
    Region("anyharness/crates/anyharness-lib/src/integrations", "integrations/", "machinery: vendor leaves (areas/anyharness)", "areas", "owned", "", "Runtime — AnyHarness (Rust)"),
    Region("anyharness/crates/anyharness-contract", "anyharness-contract", "machinery: wire contracts, generated", "areas", "owned", "", "Runtime — AnyHarness (Rust)"),
    Region("anyharness/crates/proliferate-worker", "proliferate-worker", "environments (seam)", "place", "owned", "", "Runtime — AnyHarness (Rust)"),
    Region("anyharness/crates/proliferate-supervisor", "proliferate-supervisor", "desktop-host", "place", "owned", "", "Runtime — AnyHarness (Rust)"),
    Region("anyharness/crates/proliferate-diagnostics-collector", "diagnostics-collector", "engineering/observability", "engineering", "owned", "", "Runtime — AnyHarness (Rust)"),
    Region("anyharness/crates/proliferate-diagnostics-client", "diagnostics-client", "engineering/observability", "engineering", "owned", "", "Runtime — AnyHarness (Rust)"),
    Region("anyharness/crates/proliferate-diagnostics-protocol", "diagnostics-protocol", "engineering/observability", "engineering", "owned", "", "Runtime — AnyHarness (Rust)"),
    # ---- Clients (TypeScript) ----
    Region("apps/packages/product-client", "apps/packages/product-client", "chat · workspace-surface · runs-triage · settings · onboarding", "windows", "shared", "chat · workspace-surface · runs-triage · settings · onboarding — per-surface re-fence is Wave 4", "Clients (TypeScript)"),
    Region("apps/packages/design", "apps/packages/design", "DESIGN_SYSTEM", "windows", "owned", "", "Clients (TypeScript)"),
    Region("apps/desktop", "apps/desktop", "desktop-host", "place", "owned", "", "Clients (TypeScript)"),
    Region("apps/web", "apps/web", "shell (areas/frontend)", "areas", "owned", "", "Clients (TypeScript)"),
    Region("apps/mobile", "apps/mobile", "—", "", "unowned", "retire vs re-point, ruling pending", "Clients (TypeScript)"),
    Region("cloud/sdk", "cloud/sdk", "machinery: generated CP client", "areas", "owned", "", "Clients (TypeScript)"),
    # ---- Server plumbing · data · engineering ----
    Region("server/litellm", "server/litellm", "ai_gateway", "keys", "owned", "", "Server plumbing · data · engineering"),
    Region("server/proliferate/auth", "server/…/auth", "identity", "keepers", "owned", "", "Server plumbing · data · engineering"),
    Region("server/proliferate/db", "server/…/db", "machinery: db (alembic tree; every migration owned by the system whose rows change)", "areas", "owned", "", "Server plumbing · data · engineering"),
    Region("server/proliferate/background", "server/…/background", "machinery: celery (every task owned by its system)", "areas", "owned", "", "Server plumbing · data · engineering"),
    Region("server/proliferate/integrations", "server/…/integrations", "machinery: vendor leaves (no product logic — the contract deserves its own page)", "areas", "owned", "", "Server plumbing · data · engineering"),
    Region("server/proliferate/lib", "server/…/lib", "machinery: shared lib (declared consumers only)", "areas", "owned", "", "Server plumbing · data · engineering"),
    Region("server/proliferate/middleware", "server/…/middleware", "convention (areas/server)", "areas", "owned", "", "Server plumbing · data · engineering"),
    Region("server/proliferate/constants", "server/…/constants", "convention (areas/server)", "areas", "owned", "", "Server plumbing · data · engineering"),
    Region("server/infra", "server/infra", "engineering/infra", "engineering", "owned", "", "Server plumbing · data · engineering"),
    Region("scripts", "scripts/", "engineering/shipping", "engineering", "owned", "", "Server plumbing · data · engineering"),
    Region("lints", "lints/", "engineering/shipping", "engineering", "owned", "", "Server plumbing · data · engineering"),
]


def get_repo_root() -> Path:
    """Resolve the repo root the script is running against.

    Tries `git rev-parse --show-toplevel` first (correct even inside a
    worktree); falls back to a path relative to this file so the script
    still works if git is unavailable.
    """
    script_dir = Path(__file__).resolve().parent
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=script_dir,
            capture_output=True,
            text=True,
            check=True,
        )
        return Path(out.stdout.strip())
    except (OSError, subprocess.CalledProcessError):
        return script_dir.parents[1]


def get_git_branch(repo_root: Path) -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=True,
        )
        return out.stdout.strip() or "unknown"
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def build_data(repo_root: Path) -> dict:
    entries = []
    for region in OWNERSHIP:
        full = repo_root / region.rel_path
        if not full.is_dir():
            print(f"warning: {region.rel_path!r} not found, skipping", file=sys.stderr)
            continue
        loc = count_loc(full)
        if not loc:
            continue
        entries.append({
            "p": region.display,
            "s": region.spec,
            "r": region.role,
            "st": region.status,
            "n": region.note,
            "l": loc,
            "leg": region.leg,
        })

    total = sum(e["l"] for e in entries)
    unowned = sum(e["l"] for e in entries if e["st"] == "unowned")
    shared = sum(e["l"] for e in entries if e["st"] == "shared")
    owned = total - unowned - shared
    stats = {
        "total": total,
        "owned": owned,
        "shared": shared,
        "unowned": unowned,
        "unowned_n": sum(1 for e in entries if e["st"] == "unowned"),
        "shared_n": sum(1 for e in entries if e["st"] == "shared"),
        "date": date.today().isoformat(),
        "branch": get_git_branch(repo_root),
    }
    return {"stats": stats, "entries": entries}


def render_html(template_path: Path, data: dict) -> str:
    template = template_path.read_text(encoding="utf-8")
    payload = json.dumps(data, ensure_ascii=False)
    if "__DATA__" not in template:
        raise ValueError(f"{template_path} has no __DATA__ placeholder")
    return template.replace("__DATA__", payload, 1)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "output",
        nargs="?",
        default=None,
        help="where to write the page (default: ownership-atlas.html next to this script)",
    )
    args = parser.parse_args(argv)

    script_dir = Path(__file__).resolve().parent
    output_path = Path(args.output) if args.output else script_dir / "ownership-atlas.html"
    template_path = script_dir / "template.html"

    repo_root = get_repo_root()
    data = build_data(repo_root)
    html = render_html(template_path, data)
    output_path.write_text(html, encoding="utf-8")

    stats = data["stats"]
    print(
        f"total {stats['total']} LOC across {len(data['entries'])} regions · "
        f"owned {stats['owned']} · shared {stats['shared']} ({stats['shared_n']}) · "
        f"unowned {stats['unowned']} ({stats['unowned_n']}) · wrote {output_path}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
