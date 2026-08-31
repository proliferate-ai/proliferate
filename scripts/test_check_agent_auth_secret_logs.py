#!/usr/bin/env python3

"""The accept cases carry the weight: an opaque `virtual_key_id` handle, a
redacted hint, and non-log code that mentions a secret are all normal and must
stay silent. What is banned is narrow — a live secret binding inside a log or
tracing call — so a guard that flagged every mention of `virtual_key` would ban
the safe handle along with the raw key."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts import check_agent_auth_secret_logs as checker
from scripts.check_agent_auth_secret_logs import scan_file


def scanned(source: str, suffix: str = ".py") -> list[checker.Finding]:
    with tempfile.NamedTemporaryFile("w", suffix=suffix, delete=False) as handle:
        handle.write(source)
        path = Path(handle.name)
    try:
        return scan_file(path)
    finally:
        path.unlink()


def hit(source: str, suffix: str = ".py") -> bool:
    return bool(scanned(source, suffix))


class RecordCoverageTest(unittest.TestCase):
    def test_checker_owns_exactly_its_record(self) -> None:
        self.assertEqual(checker.OWNED_RULE_IDS, frozenset({checker.RULE_ID}))

    def test_diagnostic_cites_the_rule_and_the_record(self) -> None:
        diagnostic = scanned('logger.info("minted %s", virtual_key)')[0].format()
        self.assertIn("PROD-AGENTAUTH-001", diagnostic)
        self.assertIn("lints/product/agent_auth.toml", diagnostic)


class ScannedRootsTest(unittest.TestCase):
    def test_every_scanned_root_exists(self) -> None:
        # A root that vanishes in a refactor is coverage that vanishes with it:
        # `iter_source_files` skips missing roots silently, so this is the
        # only thing that notices.
        missing = [
            root for root, _ in checker.SCANNED_ROOTS if not (checker.REPO_ROOT / root).exists()
        ]
        self.assertEqual(missing, [])

    def test_seat_plane_is_scanned(self) -> None:
        roots = {root for root, _ in checker.SCANNED_ROOTS}
        self.assertIn("anyharness/crates/anyharness-lib/src/domains/agents/seat_cooling", roots)
        self.assertIn("anyharness/crates/anyharness-lib/src/live/sessions", roots)

    def test_scope_record_names_every_scanned_root(self) -> None:
        scope = checker.RULES.rule(checker.RULE_ID).scope
        for root, _ in checker.SCANNED_ROOTS:
            self.assertIn(root, scope)


class SecretInLogRejected(unittest.TestCase):
    def test_raw_virtual_key_python(self) -> None:
        self.assertTrue(hit('logger.info("minted %s", virtual_key)'))

    def test_value_ciphertext_python(self) -> None:
        self.assertTrue(hit('logger.warning("stored %s", value_ciphertext)'))

    def test_provider_env_secret_name(self) -> None:
        self.assertTrue(hit('logger.debug("set ANTHROPIC_AUTH_TOKEN=%s", token)'))

    def test_wrapped_call_across_lines(self) -> None:
        self.assertTrue(
            hit(
                "logger.info(\n"
                '    "rotated key for team %s: %s",\n'
                "    team_id,\n"
                "    virtual_key,\n"
                ")"
            )
        )

    def test_rust_tracing_macro(self) -> None:
        self.assertTrue(
            hit('tracing::warn!(%virtual_key, "delivering gateway key");', suffix=".rs")
        )

    def test_rust_bare_macro(self) -> None:
        self.assertTrue(hit('error!("leaked {}", value_ciphertext);', suffix=".rs"))

    def test_minted_key_attribute_access(self) -> None:
        # The live secret flows as `minted.key` (MintedVirtualKey), not a
        # `virtual_key` local — the checker must catch the attribute form.
        self.assertTrue(hit('logger.info("minted gateway key %s", minted.key)'))

    def test_secret_attribute_in_extra_dict(self) -> None:
        self.assertTrue(hit('logger.info("done", extra={"vkey": minted.key})'))

    def test_bare_api_key_binding(self) -> None:
        self.assertTrue(hit('logger.info("provider api_key=%s", api_key)'))

    def test_token_attribute_access(self) -> None:
        self.assertTrue(hit('logger.info("delivering %s", credential.token)'))

    def test_seat_env_map_attribute_access(self) -> None:
        # The seat token lives INSIDE `SeatProfile.env`; debug-printing the map
        # ships it whole. This is the seat-plane shape the guard must catch.
        self.assertTrue(hit('tracing::warn!(?seat.env, "seat limit hit");', suffix=".rs"))

    def test_provider_config_env_map_in_python(self) -> None:
        self.assertTrue(hit('logger.info("resolved env %s", profile.env)'))

    def test_seat_env_names(self) -> None:
        for name in (
            "CLAUDE_CODE_OAUTH_TOKEN",
            "ANTHROPIC_API_KEY",
            "AWS_BEARER_TOKEN_BEDROCK",
            "ANTHROPIC_FOUNDRY_API_KEY",
            "AZURE_API_KEY",
        ):
            with self.subTest(name=name):
                self.assertTrue(hit(f'info!("set {name}={{}}", value);', suffix=".rs"))

    def test_seat_pool_bindings(self) -> None:
        self.assertTrue(hit('logger.debug("pool %s", seat_values)'))
        self.assertTrue(hit('debug!(?seat_source, "seat source");', suffix=".rs"))


class SafeSitesAccepted(unittest.TestCase):
    def test_env_var_name_is_not_the_env_map(self) -> None:
        # `.env_var_name` is the public NAME of the variable, not the map that
        # holds its value — the `_` blocks the `.env` boundary.
        self.assertFalse(hit('info!(%profile.env_var_name, "binding");', suffix=".rs"))

    def test_std_env_path_is_not_an_attribute(self) -> None:
        self.assertFalse(hit('warn!("origin {:?}", std::env::var("HOME"));', suffix=".rs"))

    def test_seat_id_handle_is_safe(self) -> None:
        self.assertFalse(hit('tracing::warn!(%seat.seat_id, "seat cooling");', suffix=".rs"))

    def test_opaque_handle_is_safe(self) -> None:
        self.assertFalse(hit('logger.info("minted %s", virtual_key_id)'))

    def test_secret_outside_a_log_call_is_ignored(self) -> None:
        self.assertFalse(hit("stored = encrypt(virtual_key)"))

    def test_ciphertext_id_reference_is_safe(self) -> None:
        self.assertFalse(hit('logger.info("wrote %s", value_ciphertext_id)'))

    def test_allow_pragma_exempts_a_reviewed_site(self) -> None:
        self.assertFalse(
            hit('logger.debug("redacted %s", redact(virtual_key))  # agent-auth:allow-secret-log')
        )

    def test_paren_inside_string_does_not_truncate_the_call(self) -> None:
        # The `)` in the message must not close the call before the secret arg.
        self.assertTrue(hit('logger.info("done (ok) %s", virtual_key)'))

    def test_keys_iteration_is_not_key_attribute(self) -> None:
        # `.keys()` is a dict iteration, not a `.key` secret access — the tail
        # word-boundary keeps it silent.
        self.assertFalse(hit('logger.info("fields %s", list(payload.keys()))'))

    def test_token_id_handle_is_safe(self) -> None:
        # `.token_id` is the opaque handle, not the raw `.token`.
        self.assertFalse(hit('logger.info("minted %s", minted.token_id)'))

    def test_virtual_key_ciphertext_column_is_safe(self) -> None:
        # The stored-ciphertext column name is not the raw `virtual_key`.
        self.assertFalse(hit('logger.info("row %s", row.virtual_key_ciphertext)'))


if __name__ == "__main__":
    unittest.main()
