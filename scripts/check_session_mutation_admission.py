#!/usr/bin/env python3
"""Session mutation admission ratchet (spec 2b, founder ruling 2).

Every HTTP route handler reachable through a mutating method (post/put/patch/
delete) in the AnyHarness API must be CLASSIFIED in
scripts/session_mutation_admission.txt. Classes:

  fenced           handler must call an admit_* helper, and that call must
                   appear BEFORE any of the enumerated effect surfaces
                   (syntactic ordering; the behavioral before-side-effect
                   guarantee is proven by the admission conflict-matrix tests)
  engine-fenced    admission is enforced one seam deeper: the handler delegates
                   to an agent-operations `*_lifecycle` engine method that calls
                   admit_target BEFORE its store write, and that seam is fenced
                   by scripts/session_mutation_admission_non_http.txt. The HTTP
                   handler must NOT re-admit — admit_target shares the
                   per-session permit, so a second acquire on the same stack
                   would deadlock.
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
is an error. Router composition via `.merge(<module>::routes())` is followed so
handlers assembled from sub-modules cannot hide from enumeration; a merged
module that cannot be resolved to a source file fails LOUDLY (a `.merge()`
blind spot is impossible to add silently). Additionally, session core
(domains/sessions/**) must never import the Workflows domain.
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
ADMIT_RE = re.compile(r"admit_session_mutation|admit_review_parent_session|admit_plan_session|admit_all_workspace_sessions|admit_target")
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
# Router composition: `.merge(<module>::routes())` (or `::router()`, etc.). The
# composed module's own route registrations must be enumerated too, otherwise a
# merged sub-router is a blind spot for the whole ratchet.
MERGE_RE = re.compile(r"\.merge\(\s*([a-z_0-9]+)::[a-z_0-9]+\s*\(\s*\)\s*\)")
# An engine-fenced handler delegates to an agent-operations `*_lifecycle` seam
# that owns the admit_target call; used to require that seam is fenced in the
# non-HTTP owner inventory.
LIFECYCLE_SEAM_RE = re.compile(r"\.([a-z_0-9]+_lifecycle)\s*\(")
CLASS_LINE_RE = re.compile(r"^([a-z_0-9]+::[a-z_0-9]+)\s+(fenced|engine-fenced|derived-safe|read-like|cosmetic|creation|workspace-scoped|workflow-plane)\s+(.+)$")


def _resolve_router_module_file(module: str) -> Path | None:
    """Resolve a `.merge(<module>::…())` module name to its source file."""
    for candidate in (
        HTTP_DIR / f"{module}.rs",
        API_DIR / f"{module}.rs",
        API_DIR / "router" / f"{module}.rs",
    ):
        if candidate.exists():
            return candidate
    return None


def _enumerate_router_text(
    text: str,
    label: str,
    self_module: str | None,
    handlers: set[str],
    unresolved: list[str],
) -> list[str]:
    """Enumerate mutating handlers in one router text and return the sub-modules
    it composes via `.merge(<module>::…())`.

    `self_module` is the module a BARE handler ref (`post(fn)`) resolves to when
    it is not brought in by a `use` import. Inside a merged `routes()` module,
    same-module handler fns are registered bare and belong to that module; a
    top-level router file passes `None`, where a bare ref MUST resolve via
    imports or fail loudly."""
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
        module = import_map.get(fn, self_module)
        if module is None:
            unresolved.append(f"{label}: bare handler '{fn}' not resolvable via imports")
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
            f"{label}: route handler ref '{path}' has an unsupported "
            f"segment count and escaped enumeration; classify it explicitly"
        )
    return MERGE_RE.findall(text)


def collect_mutating_handlers() -> set[str]:
    handlers: set[str] = set()
    unresolved: list[str] = []
    pending_modules: list[str] = []
    for router in ROUTER_FILES:
        pending_modules.extend(
            _enumerate_router_text(
                router.read_text(), router.name, None, handlers, unresolved
            )
        )
    # Follow `.merge(<module>::routes())` composition so a router assembled from
    # sub-modules cannot hide its mutating handlers from the ratchet. A merged
    # module that cannot be resolved to a source file fails LOUDLY — this makes
    # `.merge()`-style blind spots impossible to introduce silently (PR review).
    seen_modules: set[str] = set()
    while pending_modules:
        module = pending_modules.pop()
        if module in seen_modules:
            continue
        seen_modules.add(module)
        module_file = _resolve_router_module_file(module)
        if module_file is None:
            unresolved.append(
                f"router merge: module '{module}' composed via .merge(...) could "
                f"not be resolved to a source file; the admission ratchet cannot "
                f"see its routes"
            )
            continue
        pending_modules.extend(
            _enumerate_router_text(
                module_file.read_text(),
                module_file.name,
                module,
                handlers,
                unresolved,
            )
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


def strip_rust_comments_and_strings(text: str) -> str:
    """Remove Rust line/block comments and string literals from `text`, leaving
    everything else (including whitespace) in place.

    Without this, a decoy inside a comment or string literal — e.g.
    `let _s = "admit_retention_sessions";` or `//admit_retention_sessions()` —
    would satisfy the flatten+search below even after the real admission call
    was deleted. Handled forms: `//` line comments, `/* */` block comments
    (non-greedy; nested blocks are not required), regular `"..."` strings with
    backslash escapes, and raw strings `r"..."` / `r#"..."#` (any hash count).
    Comment/string contents are dropped entirely so nothing inside them can be
    matched as code."""
    out: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        # Raw string: r"...", r#"..."#, r##"..."##, ...
        if ch == "r" and i + 1 < n and text[i + 1] in ('"', "#"):
            j = i + 1
            hashes = 0
            while j < n and text[j] == "#":
                hashes += 1
                j += 1
            if j < n and text[j] == '"':
                closing = '"' + ("#" * hashes)
                end = text.find(closing, j + 1)
                i = (end + len(closing)) if end >= 0 else n
                continue
            out.append(ch)
            i += 1
            continue
        # Regular string literal with escape handling.
        if ch == '"':
            j = i + 1
            while j < n:
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == '"':
                    j += 1
                    break
                j += 1
            i = j
            continue
        # Comments.
        if ch == "/" and i + 1 < n:
            nxt = text[i + 1]
            if nxt == "/":
                end = text.find("\n", i + 2)
                i = end if end >= 0 else n
                continue
            if nxt == "*":
                end = text.find("*/", i + 2)
                i = (end + 2) if end >= 0 else n
                continue
        out.append(ch)
        i += 1
    return "".join(out)


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
    failure (mirrors the HTTP checker's stale-entry teeth).

    Rust line/block comments and string literals are stripped from the body
    BEFORE the flatten+search so a decoy token in a comment or string cannot
    satisfy the check when the real admission call has been deleted."""
    failures: list[str] = []
    for rel_path, fn, admit_call, effects in load_non_http_owners():
        body = owner_body(rel_path, fn)
        if body is None:
            failures.append(
                f"STALE non-HTTP owner entry {rel_path}::{fn}: function not found "
                f"(remove it or fix the entry)"
            )
            continue
        # Strip comments/string literals, then collapse whitespace so rustfmt
        # line splits don't affect ordering and no decoy in a comment/string can
        # be matched as code.
        flat = re.sub(r"\s+", "", strip_rust_comments_and_strings(body))
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
    non_http_owners = load_non_http_owners()
    # fn -> set of admit calls that fence it, for engine-fenced cross-checking.
    non_http_admit_by_fn: dict[str, set[str]] = {}
    for _rel, fn, admit_call, _effects in non_http_owners:
        non_http_admit_by_fn.setdefault(fn, set()).add(admit_call)
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
        elif cls == "engine-fenced":
            # Admission is enforced one seam deeper: the handler delegates to an
            # agent-operations `*_lifecycle` engine method that calls admit_target
            # before its store write. (The HTTP handler must NOT re-admit —
            # admit_target and admit_session_mutation share the per-session
            # permit, so a second acquire on the same stack would deadlock.)
            # Require the delegated seam to be fenced by a non-HTTP owner entry
            # with admit_target, whose admit-before-effect ordering + stale-entry
            # teeth are enforced by check_non_http_owners(). This keeps the class
            # from being an escape hatch: it is only valid when a verified seam
            # backs it.
            seam_calls = sorted(set(LIFECYCLE_SEAM_RE.findall(body)))
            if not seam_calls:
                failures.append(
                    f"{key}: classified 'engine-fenced' but its handler delegates "
                    f"to no `*_lifecycle` engine seam; wire the admission seam or "
                    f"reclassify"
                )
            elif not any(
                "admit_target" in non_http_admit_by_fn.get(seam, set())
                for seam in seam_calls
            ):
                failures.append(
                    f"{key}: classified 'engine-fenced' but none of its engine "
                    f"seams {seam_calls} are fenced with admit_target in "
                    f"scripts/session_mutation_admission_non_http.txt"
                )

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
    # post-create automatic passes) are fenced statically here too. (Inventory
    # already loaded above for engine-fenced cross-checking.)
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
