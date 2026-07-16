#!/usr/bin/env python3
"""Session mutation admission ratchet (spec 2b, founder ruling 2).

Every HTTP route handler reachable through a mutating method (post/put/patch/
delete) in the AnyHarness API must be CLASSIFIED in
scripts/session_mutation_admission.txt. Classes:

  fenced           handler must call an admit_* helper, and that call must
                   appear BEFORE any of the enumerated effect surfaces
                   (syntactic ordering; the behavioral before-side-effect
                   guarantee is proven by the admission conflict-matrix tests)
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
LIB_SRC_DIR = REPO_ROOT / "anyharness/crates/anyharness-lib/src"
SESSIONS_DIR = REPO_ROOT / "anyharness/crates/anyharness-lib/src/domains/sessions"
CLASSIFICATION_PATH = REPO_ROOT / "scripts/session_mutation_admission.txt"
# PR1227-RETENTION-RATCHET-01: non-HTTP destructive owners reached outside the
# router (startup / post-create automatic passes). The HTTP ratchet above only
# sees router handlers, so these are enumerated + fenced separately here.
NON_HTTP_OWNERS_PATH = REPO_ROOT / "scripts/session_mutation_admission_non_http.txt"

ROUTER_FILES = [API_DIR / "router.rs", API_DIR / "router" / "pending_prompt_routes.rs"]
MUTATING = ("post", "put", "patch", "delete")
ADMIT_RE = re.compile(r"admit_session_mutation|admit_review_parent_session|admit_plan_session|admit_all_workspace_sessions")
# The enumerated effect surfaces a fenced handler may only touch AFTER
# admission. This is a syntactic ordering ratchet over known runtime/service
# fields, not a full effect analysis — the behavioral proof is the admission
# test battery. Extend this list when a new effectful surface appears in a
# fenced handler.
EFFECT_TOKENS = (
    ".session_runtime.",
    ".goal_runtime.",
    ".loop_runtime.",
    ".plan_runtime.",
    ".review_runtime.",
    ".workspace_purge_service.",
    ".mobility_service.",
    ".subagent_service.",
    ".workspace_runtime.",
    ".workspace_setup_runtime.",
    ".session_service.",
)
HANDLER_REF_RE = re.compile(r"\b(post|put|patch|delete)\(\s*([a-z_0-9]+)::([a-z_0-9]+)\s*[),]")
# Routes may also reference directly-imported handler names (e.g.
# `put(put_agent_auth_state)`); resolve those through the router's own use
# imports so no mutating handler can escape enumeration.
BARE_HANDLER_REF_RE = re.compile(r"\b(post|put|patch|delete)\(\s*([a-z_0-9]+)\s*[),]")
# Catch-all: ANY mutating-verb route reference, including doubly-qualified
# paths like `post(a::b::c)` that match NEITHER of the two shapes above and
# would otherwise escape enumeration silently (PR1227-RATCHET-01). Every
# capture must be covered by the qualified/bare/import-resolved sets; anything
# left over is routed into `unresolved` so it FAILS LOUDLY.
ANY_HANDLER_REF_RE = re.compile(r"\b(post|put|patch|delete)\(\s*([A-Za-z_0-9:]+)\s*[),]")
IMPORT_GROUP_RE = re.compile(r"([a-z_0-9]+)::\{([^{}]*)\}", re.S)
CLASS_LINE_RE = re.compile(r"^([a-z_0-9]+::[a-z_0-9]+)\s+(fenced|derived-safe|read-like|cosmetic|creation|workspace-scoped|workflow-plane)\s+(.+)$")


def collect_mutating_handlers() -> set[str]:
    handlers: set[str] = set()
    unresolved: list[str] = []
    for router in ROUTER_FILES:
        text = router.read_text()
        qualified: set[str] = set()
        for _method, module, fn in HANDLER_REF_RE.findall(text):
            handlers.add(f"{module}::{fn}")
            qualified.add(fn)
        import_map: dict[str, str] = {}
        for module, group in IMPORT_GROUP_RE.findall(text):
            for name in group.split(","):
                name = name.strip()
                if name:
                    import_map[name] = module
        for _method, fn in BARE_HANDLER_REF_RE.findall(text):
            if fn in qualified:
                continue
            module = import_map.get(fn)
            if module is None:
                unresolved.append(f"{router.name}: bare handler '{fn}' not resolvable via imports")
            else:
                handlers.add(f"{module}::{fn}")
        # Catch-all teeth (PR1227-RATCHET-01): the two shapes above only match
        # bare (`fn`) and singly-qualified (`module::fn`) references. A ref with
        # any other segment count — notably doubly-qualified `post(a::b::c)` —
        # is covered by NEITHER and would slip through unenumerated. Route every
        # such leftover into `unresolved` so it fails loudly instead of silently
        # escaping the admission decision.
        for _method, path in ANY_HANDLER_REF_RE.findall(text):
            segments = path.split("::")
            if len(segments) == 1 or len(segments) == 2:
                # Bare or singly-qualified: already handled above.
                continue
            unresolved.append(
                f"{router.name}: route handler ref '{path}' has an unsupported "
                f"segment count and escaped enumeration; classify it explicitly"
            )
    if unresolved:
        raise SystemExit("Unresolvable bare route handlers:\n  " + "\n  ".join(unresolved))
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


NON_HTTP_LINE_RE = re.compile(r"^(\S+)::([A-Za-z_0-9]+)\s+([A-Za-z_0-9]+)\s+(\S+)$")


def load_non_http_owners() -> list[tuple[str, str, str, list[str]]]:
    """Parse the non-HTTP destructive owner inventory.

    Each entry is `path::fn admit_call effect_token[,effect_token...]`.
    """
    owners: list[tuple[str, str, str, list[str]]] = []
    for lineno, line in enumerate(NON_HTTP_OWNERS_PATH.read_text().splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        match = NON_HTTP_LINE_RE.match(line)
        if not match:
            raise SystemExit(
                f"{NON_HTTP_OWNERS_PATH.name}:{lineno}: expected "
                f"'path::fn admit_call effect_token[,effect_token...]'"
            )
        rel_path, fn, admit_call, effects = match.groups()
        owners.append((rel_path, fn, admit_call, [e for e in effects.split(",") if e]))
    return owners


def owner_body(rel_path: str, fn: str) -> str | None:
    """Extract the brace-balanced body of `fn` in `rel_path` (relative to the
    anyharness-lib src dir). Returns None if the file or function is absent —
    the caller turns that into a stale-entry failure."""
    file_path = LIB_SRC_DIR / rel_path
    if not file_path.exists():
        return None
    text = file_path.read_text()
    idx = -1
    for decl in (f"fn {fn}(", f"fn {fn}<"):
        idx = text.find(decl)
        if idx >= 0:
            break
    if idx < 0:
        return None
    brace = text.find("{", idx)
    if brace < 0:
        return None
    depth = 0
    for pos in range(brace, len(text)):
        ch = text[pos]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[idx : pos + 1]
    return text[idx:]


def check_non_http_owners() -> list[str]:
    """PR1227-RETENTION-RATCHET-01: statically enforce that each listed non-HTTP
    destructive owner calls its admission helper BEFORE any of its destructive
    effect surfaces. Absent admission call or an effect ordered ahead of it =
    failure; a listed owner whose function no longer exists = stale-entry
    failure (mirrors the HTTP checker's stale-entry teeth)."""
    failures: list[str] = []
    for rel_path, fn, admit_call, effects in load_non_http_owners():
        body = owner_body(rel_path, fn)
        if body is None:
            failures.append(
                f"STALE non-HTTP owner entry {rel_path}::{fn}: function not found "
                f"(remove it or fix the entry)"
            )
            continue
        # Whitespace-collapsed view so rustfmt line splits don't affect ordering.
        flat = re.sub(r"\s+", "", body)
        # Word-boundary match so a rename/removal (e.g. `admit_x` -> `no_admit_x`)
        # is caught rather than matching as a substring.
        admit_match = re.search(rf"(?<![A-Za-z0-9_]){re.escape(admit_call)}(?![A-Za-z0-9_])", flat)
        admit_idx = admit_match.start() if admit_match else -1
        if admit_idx < 0:
            failures.append(
                f"{rel_path}::{fn}: non-HTTP destructive owner is missing its "
                f"admission call '{admit_call}' — permit-first admission must not "
                f"be removed"
            )
            continue
        flat_effects = [re.sub(r"\s+", "", e) for e in effects]
        for effect in flat_effects:
            effect_idx = flat.find(effect)
            if 0 <= effect_idx < admit_idx:
                failures.append(
                    f"{rel_path}::{fn}: effect surface '{effect}' appears BEFORE "
                    f"the admission call '{admit_call}' — admission must come first"
                )
                break
    return failures


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
        if cls == "fenced":
            # rustfmt splits field chains across lines, so ordering is checked
            # on a whitespace-collapsed view of the handler body.
            flat = re.sub(r"\s+", "", body)
            admit = ADMIT_RE.search(flat)
            if not admit:
                failures.append(
                    f"{key}: classified 'fenced' but no admit_* call in the handler"
                )
            else:
                for token in EFFECT_TOKENS:
                    effect_idx = flat.find(token)
                    if 0 <= effect_idx < admit.start():
                        failures.append(
                            f"{key}: effect surface '{token}' appears BEFORE the "
                            f"admission call — admission must come first"
                        )
                        break

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

    # PR1227-RETENTION-RATCHET-01: non-HTTP destructive owners (startup /
    # post-create automatic passes) are fenced statically here too.
    non_http_owners = load_non_http_owners()
    failures.extend(check_non_http_owners())

    if failures:
        print("Session mutation admission ratchet failures:")
        for failure in failures:
            print(f"  {failure}")
        return 1
    print(
        f"Session mutation admission ratchet passed "
        f"({len(handlers)} mutating handlers classified, "
        f"{len(non_http_owners)} non-HTTP owners fenced)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
