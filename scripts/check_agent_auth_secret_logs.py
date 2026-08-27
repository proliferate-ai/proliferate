#!/usr/bin/env python3

"""Keep agent-auth secrets out of structured-log call sites.

The agent-auth surfaces move real provider secrets and minted gateway keys
through their hot paths: the cloud enrollment/migration/topup flows in
``server/proliferate/server/agent_auth`` and
``server/proliferate/server/ai_gateway`` and the AnyHarness render and
model-snapshot planes under ``route_auth`` / ``model_snapshot``. A single
``logger.info("minted %s", virtual_key)`` or ``tracing::warn!(%value_ciphertext,
...)`` writes a live credential into logs that ship to a collector — an
irreversible leak the moment it runs.

This guard makes that shape unwritable. It reads every logging / tracing call
site in those surfaces (not all code — only the log call, extracted by balanced
parentheses) and fails on any of the known secret identifiers appearing inside
one:

  - the provider env-var secret NAMES a rendered source binds
    (``PROLIFERATE_GATEWAY_KEY``, ``ANTHROPIC_AUTH_TOKEN``, ``XAI_API_KEY``,
    ``CURSOR_API_KEY``, ``OPENAI_API_KEY``) — logging the name is how the value
    next to it slips in;
  - the raw secret variable names ``virtual_key`` (the minted key itself, as
    opposed to the safe ``virtual_key_id`` handle), ``value_ciphertext``, and the
    bare ``api_key`` binding;
  - ATTRIBUTE ACCESS of a secret field — ``<receiver>.key`` / ``.token`` /
    ``.api_key`` — because the live minted key actually flows as
    ``minted.key`` (``MintedVirtualKey``), not through a ``virtual_key`` local.
    A word-boundary at the tail keeps this narrow and free of the obvious
    false positives: ``.keys()`` iteration is NOT ``.key`` (the ``s`` blocks the
    boundary), and the safe ``.token_id`` handle is NOT ``.token`` (the ``_``
    blocks the boundary), exactly as ``virtual_key_id`` is safe from
    ``virtual_key``. An audit of every ``.key``/``.token``/``.api_key`` access and
    every log call under the scanned roots on both this branch and the live
    ``r4-gateway-verification`` gateway code found ZERO legitimate secret-field
    attribute access inside a log call, so no receiver-name allowlist is needed;
    the only real ``minted.key`` sites are non-log ``upsert_enrollment_key``
    keyword args. Bare ``token``/``value`` words are deliberately NOT matched —
    they are far too common (``value.keys()``, plain ``token`` counters) to flag
    without absurd noise; only the attribute form and the ``value_ciphertext``
    binding are caught. As a lexical guard it also stays silent on
    non-idiomatic forms (``minted["key"]`` subscripts, ``getattr(minted,
    "key")``, spaced or line-split attribute access); none appear in the real
    code, and review remains the backstop for those shapes.

An intentional, reviewed redaction site marks itself with an inline pragma
``agent-auth:allow-secret-log`` inside the call; that one call is exempt. The
rule is ``PROD-AGENTAUTH-001``; the record under
``lints/product/agent_auth.toml`` is canonical and every diagnostic is rendered
from it via ``scripts/lint_records.py``.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    # Run as `python3 scripts/check_agent_auth_secret_logs.py` from the repo
    # root; sys.path[0] is scripts/, and the shared loader lives one level up.
    sys.path.insert(0, str(REPO_ROOT))

from scripts import lint_records  # noqa: E402  (path shim must precede the import)

CHECKER = "scripts/check_agent_auth_secret_logs.py"
RULE_ID = "PROD-AGENTAUTH-001"
RULES = lint_records.load("product")
OWNED_RULE_IDS = frozenset(
    rule.id for rule in RULES.rules.values() if rule.enforced_by == CHECKER
)

# (root, suffixes) — Python cloud gateway surface, the ciphertext/plaintext
# custody planes (store + models + encryption, where ``value_ciphertext`` and
# the decrypt paths actually live), and the Rust render + snapshot planes.
SCANNED_ROOTS: list[tuple[str, frozenset[str]]] = [
    ("server/proliferate/server/agent_auth", frozenset({".py"})),
    ("server/proliferate/server/ai_gateway", frozenset({".py"})),
    ("server/proliferate/db/store/agent_gateway", frozenset({".py"})),
    ("server/proliferate/db/models/agent_gateway.py", frozenset({".py"})),
    ("server/proliferate/db/models/cloud", frozenset({".py"})),
    ("server/proliferate/lib/infra/encryption", frozenset({".py"})),
    (
        "anyharness/crates/anyharness-lib/src/domains/agents/route_auth",
        frozenset({".rs"}),
    ),
    (
        "anyharness/crates/anyharness-lib/src/domains/agents/model_snapshot",
        frozenset({".rs"}),
    ),
]

SKIPPED_DIR_NAMES = {"node_modules", "dist", "build", "target", "__pycache__"}

# The log-call openers, each ending at the opening paren. Python's `logger.info(`
# family, and Rust's `tracing::warn!(` plus the bare `warn!(` re-exported macro.
LOG_OPENER = re.compile(
    r"(?:"
    r"\b(?:log|logger|logging)\.(?:debug|info|warning|warn|error|exception|critical|log)\s*\("
    r"|(?:tracing::)?(?:debug|info|warn|error|trace)!\s*\("
    r")"
)

# The secret identifiers. `virtual_key_id` is a safe opaque handle, so the raw
# `virtual_key` is matched on a word boundary alone — the boundary cannot fall
# between `key` and `_id`, so the handle is never a hit. The attribute form
# `<receiver>.(key|token|api_key)` catches the live `minted.key` flow; the tail
# `\b` keeps `.keys()` (the `s`) and the safe `.token_id` handle (the `_`) out.
SECRET_IDENTIFIER = re.compile(
    r"(?:"
    r"PROLIFERATE_GATEWAY_KEY"
    r"|ANTHROPIC_AUTH_TOKEN"
    r"|XAI_API_KEY"
    r"|CURSOR_API_KEY"
    r"|OPENAI_API_KEY"
    r"|\bvalue_ciphertext\b"
    r"|\bvirtual_key\b"
    r"|\bapi_key\b"
    r"|\b\w+\.(?:key|token|api_key)\b"
    r")"
)

# A reviewed redaction site opts out by carrying this marker inside the call.
ALLOW_PRAGMA = "agent-auth:allow-secret-log"


@dataclass(frozen=True)
class Finding:
    """One secret-in-log violation, reported through its record."""

    lineno: int
    identifier: str
    snippet: str
    path: Path | None = None

    @property
    def relative_path(self) -> str:
        if self.path is None:
            return "<unknown>"
        try:
            return str(self.path.relative_to(REPO_ROOT))
        except ValueError:
            return str(self.path)

    def format(self) -> str:
        return lint_records.render_diagnostic(
            RULES.rule(RULE_ID),
            f"{self.relative_path}:{self.lineno}",
            f"secret identifier {self.identifier!r} inside a log call: {self.snippet!r}",
        )


def _call_span(text: str, open_paren: int) -> tuple[int, str]:
    """Return (end_index, call_text) for the balanced parens from `open_paren`.

    `open_paren` indexes the `(`. Scans forward counting parens so a nested
    call — an f-string with `redact(key)` in it — does not truncate the span.
    String literals are honored so a `)` inside a quoted message never closes
    the call early. Returns the index just past the matching `)`.
    """
    depth = 0
    quote: str | None = None
    i = open_paren
    n = len(text)
    while i < n:
        ch = text[i]
        if quote is not None:
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                quote = None
        elif ch in "\"'`":
            quote = ch
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return i + 1, text[open_paren : i + 1]
        i += 1
    # Unbalanced (truncated file / macro); take the rest so a real hit inside is
    # still seen rather than silently dropped.
    return n, text[open_paren:n]


def scan_file(path: Path) -> list[Finding]:
    try:
        text = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return []

    findings: list[Finding] = []
    for opener in LOG_OPENER.finditer(text):
        open_paren = opener.end() - 1
        end, call_text = _call_span(text, open_paren)
        # The reviewed-site pragma may sit inside the call or in a trailing
        # comment on the line the call closes on, so widen the exempt window to
        # the end of that closing line.
        line_end = text.find("\n", end)
        pragma_region = call_text + (text[end : line_end if line_end != -1 else len(text)])
        if ALLOW_PRAGMA in pragma_region:
            continue
        secret = SECRET_IDENTIFIER.search(call_text)
        if secret is None:
            continue
        lineno = text.count("\n", 0, opener.start()) + 1
        snippet = " ".join(call_text.split())
        if len(snippet) > 160:
            snippet = snippet[:157] + "..."
        findings.append(Finding(lineno, secret.group(0), snippet, path))
    return sorted(findings, key=lambda finding: finding.lineno)


def iter_source_files() -> list[Path]:
    files: list[Path] = []
    for root, suffixes in SCANNED_ROOTS:
        base = REPO_ROOT / root
        if not base.exists():
            continue
        if base.is_file():
            if base.suffix in suffixes:
                files.append(base)
            continue
        for path in base.rglob("*"):
            if path.suffix not in suffixes or not path.is_file():
                continue
            if any(part in SKIPPED_DIR_NAMES for part in path.parts):
                continue
            files.append(path)
    return files


def main() -> int:
    violations: list[Finding] = []
    for path in sorted(iter_source_files()):
        violations.extend(scan_file(path))

    if not violations:
        print("Agent-auth secret-log check passed.")
        return 0

    print("A live agent-auth secret must never reach a log call:")
    for violation in violations:
        print(violation.format())
        print()
    print(
        "\nLog the opaque handle (virtual_key_id), a redacted hint, or a boolean —"
        "\nnever the minted key, the ciphertext, or a provider secret env var. A"
        "\nreviewed redaction site may carry an inline `agent-auth:allow-secret-log`."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
