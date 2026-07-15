#!/usr/bin/env python3
"""Session mutation admission ratchet (spec 2b, founder ruling 2).

Every HTTP route handler reachable through a mutating method (post/put/patch/
delete) in the AnyHarness API must be CLASSIFIED in
scripts/session_mutation_admission.txt. Classes:

  fenced           handler must call an admit_* helper before side effects
  derived-safe     handler (or its engine seam) carries an
                   "admission:derived-safe" justification comment
  read-like        mutating verb but no session-execution effect (exports,
                   previews, reveals)
  cosmetic         store-only cosmetic session updates (ruling 2: title)
  creation         creates a NEW session/workspace/resource (no controller
                   can exist yet)
  workspace-scoped workspace/infra mutation with no session-execution effect
  workflow-plane   the workflow API itself (controller-side, not foreign)

A NEW mutating handler that is not classified fails this check — that is the
ratchet: adding a session mutation owner without deciding its admission story
is an error. Additionally, session core (domains/sessions/**) must never
import the Workflows domain.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
API_DIR = REPO_ROOT / "anyharness/crates/anyharness-lib/src/api"
HTTP_DIR = API_DIR / "http"
SESSIONS_DIR = REPO_ROOT / "anyharness/crates/anyharness-lib/src/domains/sessions"
CLASSIFICATION_PATH = REPO_ROOT / "scripts/session_mutation_admission.txt"

ROUTER_FILES = [API_DIR / "router.rs", API_DIR / "router" / "pending_prompt_routes.rs"]
MUTATING = ("post", "put", "patch", "delete")
ADMIT_RE = re.compile(r"admit_session_mutation|admit_review_parent_session|admit_plan_session|admit_all_workspace_sessions")
HANDLER_REF_RE = re.compile(r"\b(post|put|patch|delete)\(\s*([a-z_0-9]+)::([a-z_0-9]+)\s*[),]")
CLASS_LINE_RE = re.compile(r"^([a-z_0-9]+::[a-z_0-9]+)\s+(fenced|derived-safe|read-like|cosmetic|creation|workspace-scoped|workflow-plane)\s+(.+)$")


def collect_mutating_handlers() -> set[str]:
    handlers: set[str] = set()
    for router in ROUTER_FILES:
        text = router.read_text()
        for _method, module, fn in HANDLER_REF_RE.findall(text):
            handlers.add(f"{module}::{fn}")
    return handlers


def load_classification() -> dict[str, tuple[str, str]]:
    entries: dict[str, tuple[str, str]] = {}
    for lineno, line in enumerate(CLASSIFICATION_PATH.read_text().splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        match = CLASS_LINE_RE.match(line)
        if not match:
            raise SystemExit(f"{CLASSIFICATION_PATH.name}:{lineno}: expected 'module::fn class reason'")
        key, cls, reason = match.groups()
        if key in entries:
            raise SystemExit(f"{CLASSIFICATION_PATH.name}:{lineno}: duplicate entry {key}")
        entries[key] = (cls, reason)
    return entries


def handler_source(module: str, fn: str) -> str | None:
    candidates = [HTTP_DIR / f"{module}.rs", API_DIR / f"{module}.rs"]
    if module.startswith("http_"):
        candidates.append(HTTP_DIR / f"{module.removeprefix('http_')}.rs")
    for candidate in candidates:
        if candidate.exists():
            text = candidate.read_text()
            idx = text.find(f"pub async fn {fn}(")
            if idx < 0:
                idx = text.find(f"pub fn {fn}(")
            if idx < 0:
                continue
            nxt = text.find("\npub ", idx + 10)
            return text[idx : nxt if nxt > 0 else len(text)]
    return None


def main() -> int:
    handlers = collect_mutating_handlers()
    classification = load_classification()
    failures: list[str] = []

    for key in sorted(handlers):
        entry = classification.get(key)
        if entry is None:
            failures.append(
                f"UNCLASSIFIED mutation handler {key}: add it to "
                f"scripts/session_mutation_admission.txt with an admission decision"
            )
            continue
        cls, _reason = entry
        module, fn = key.split("::")
        body = handler_source(module, fn)
        if body is None:
            failures.append(f"{key}: classified but handler source not found")
            continue
        if cls == "fenced" and not ADMIT_RE.search(body):
            failures.append(f"{key}: classified 'fenced' but no admit_* call in the handler")

    for key in sorted(classification):
        if key not in handlers:
            failures.append(
                f"STALE classification entry {key}: no mutating route references it"
            )

    # Session-core purity: sessions must not import the Workflows domain.
    for path in SESSIONS_DIR.rglob("*.rs"):
        text = path.read_text()
        if "domains::workflows" in text or "domains/workflows" in text:
            failures.append(
                f"{path.relative_to(REPO_ROOT)}: session core must not import the Workflows domain"
            )

    if failures:
        print("Session mutation admission ratchet failures:")
        for failure in failures:
            print(f"  {failure}")
        return 1
    print(
        f"Session mutation admission ratchet passed "
        f"({len(handlers)} mutating handlers classified)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
