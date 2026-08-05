from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts import check_anyharness_boundaries as check_module

LIB_SRC_RELATIVE = "anyharness/crates/anyharness-lib/src"


class BoundaryRuleTestCase(unittest.TestCase):
    """Runs the real engine over a fabricated anyharness-lib tree."""

    def run_rules(self, files: dict[str, str]) -> list[check_module.Violation]:
        """`files` keys are paths relative to anyharness-lib/src."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            for name, content in files.items():
                path = root / LIB_SRC_RELATIVE / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")
            return check_module.collect_violations(root=root)

    def rule_ids(self, violations: list[check_module.Violation]) -> set[str]:
        return {violation.rule_id for violation in violations}

    def for_rule(
        self, violations: list[check_module.Violation], rule_id: str
    ) -> list[check_module.Violation]:
        return [violation for violation in violations if violation.rule_id == rule_id]


class DomainLiveValveTest(BoundaryRuleTestCase):
    def test_domain_service_importing_live_service_fails(self) -> None:
        violations = self.run_rules(
            {"domains/mobility/service.rs": "use crate::live::terminals::TerminalService;\n"}
        )

        matches = self.for_rule(violations, "DOMAIN_LIVE_VALVE")
        self.assertEqual(len(matches), 1)
        self.assertEqual(
            matches[0].relative_path,
            f"{LIB_SRC_RELATIVE}/domains/mobility/service.rs",
        )
        self.assertIn("runtime valve", matches[0].message)

    def test_inline_live_path_use_fails(self) -> None:
        violations = self.run_rules(
            {
                "domains/agents/entry.rs": (
                    "pub struct Entry {\n"
                    "    snapshot: crate::live::sessions::probe::ProbeSnapshot,\n"
                    "}\n"
                )
            }
        )

        matches = self.for_rule(violations, "DOMAIN_LIVE_VALVE")
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].lineno, 2)

    def test_runtime_valve_files_may_hold_live_machinery(self) -> None:
        violations = self.run_rules(
            {
                "domains/goals/runtime.rs": "use crate::live::sessions::LiveSessionManager;\n",
                "domains/sessions/live_ports.rs": (
                    "use crate::live::sessions::handle::LiveSessionHandle;\n"
                ),
                "domains/workspaces/runtime/mod.rs": (
                    "use crate::live::terminals::TerminalService;\n"
                    "fn probe() -> crate::live::sessions::probe::ProbeSnapshot { todo!() }\n"
                ),
            }
        )

        self.assertEqual(self.for_rule(violations, "DOMAIN_LIVE_VALVE"), [])

    def test_live_model_imports_are_the_sanctioned_inversion(self) -> None:
        # Domains implement live-defined observer traits, so they must be able to
        # name the model shapes those traits speak in.
        violations = self.run_rules(
            {
                "domains/plans/session_observer.rs": (
                    "use crate::live::sessions::model::{\n"
                    "    AcpChunkPayload, SessionObserverContext,\n"
                    "};\n"
                    "fn ctx() -> crate::live::sessions::model::SessionObserverContext { todo!() }\n"
                )
            }
        )

        self.assertEqual(self.for_rule(violations, "DOMAIN_LIVE_VALVE"), [])

    def test_commented_live_use_is_ignored(self) -> None:
        violations = self.run_rules(
            {
                "domains/plans/decision_op.rs": (
                    "// NOTE: crate::live::sessions::actor is private; do not reach for it.\n"
                    "pub struct Op;\n"
                )
            }
        )

        self.assertEqual(self.for_rule(violations, "DOMAIN_LIVE_VALVE"), [])

    def test_pub_use_reexport_counts_once(self) -> None:
        # `pub use` is a use-statement, so the import pass owns it; the inline
        # line pass must not double-count it.
        violations = self.run_rules(
            {"domains/sessions/mod.rs": "pub use crate::live::sessions::LiveSessionManager;\n"}
        )

        self.assertEqual(len(self.for_rule(violations, "DOMAIN_LIVE_VALVE")), 1)

    def test_test_files_are_skipped(self) -> None:
        violations = self.run_rules(
            {
                "domains/mobility/service_tests.rs": (
                    "use crate::live::terminals::TerminalService;\n"
                ),
                "domains/mobility/tests/live.rs": (
                    "use crate::live::terminals::TerminalService;\n"
                ),
            }
        )

        self.assertEqual(violations, [])


class LiveDomainStoreImportTest(BoundaryRuleTestCase):
    def test_live_importing_domain_store_fails(self) -> None:
        violations = self.run_rules(
            {"live/terminals/manager.rs": "use crate::domains::terminals::store::TerminalStore;\n"}
        )

        matches = self.for_rule(violations, "LIVE_DOMAIN_STORE_IMPORT")
        self.assertEqual(len(matches), 1)
        self.assertIn("live/ never fetches", matches[0].message)

    def test_live_importing_domain_service_fails(self) -> None:
        violations = self.run_rules(
            {
                "live/sessions/probe.rs": (
                    "use crate::domains::agents::readiness::service::resolve_agent_unrouted;\n"
                )
            }
        )

        self.assertEqual(len(self.for_rule(violations, "LIVE_DOMAIN_STORE_IMPORT")), 1)

    def test_live_importing_domain_model_passes(self) -> None:
        violations = self.run_rules(
            {
                "live/sessions/handle.rs": (
                    "use crate::domains::sessions::model::SessionRecord;\n"
                    "use crate::domains::workspaces::types::WorkspaceKind;\n"
                )
            }
        )

        self.assertEqual(self.for_rule(violations, "LIVE_DOMAIN_STORE_IMPORT"), [])


class ApiStoreEscapeTest(BoundaryRuleTestCase):
    def test_store_accessor_call_fails(self) -> None:
        violations = self.run_rules(
            {
                "api/http/mobility.rs": (
                    "async fn handler(state: AppState) {\n"
                    "    state\n"
                    "        .session_service\n"
                    "        .store()\n"
                    "        .list();\n"
                    "}\n"
                )
            }
        )

        matches = self.for_rule(violations, "API_STORE_ESCAPE")
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].lineno, 4)
        self.assertIn("domain facades", matches[0].message)

    def test_store_constructor_fails(self) -> None:
        violations = self.run_rules(
            {
                "api/http/hosting.rs": (
                    "async fn handler(state: AppState) {\n"
                    "    let store = WorkspaceStore::new(state.db.clone());\n"
                    "}\n"
                )
            }
        )

        self.assertEqual(len(self.for_rule(violations, "API_STORE_ESCAPE")), 1)

    def test_store_import_fails(self) -> None:
        violations = self.run_rules(
            {"api/http/hosting.rs": "use crate::domains::workspaces::store::WorkspaceStore;\n"}
        )

        self.assertEqual(len(self.for_rule(violations, "API_STORE_ESCAPE")), 1)

    def test_facade_call_passes(self) -> None:
        violations = self.run_rules(
            {
                "api/http/workspaces.rs": (
                    "use crate::domains::workspaces::service::WorkspaceService;\n"
                    "async fn handler(state: AppState) {\n"
                    "    state.workspace_service.list().await;\n"
                    "}\n"
                )
            }
        )

        self.assertEqual(self.for_rule(violations, "API_STORE_ESCAPE"), [])

    def test_commented_store_call_is_ignored(self) -> None:
        violations = self.run_rules(
            {"api/http/workspaces.rs": "// was: state.workspace_service.store().list()\n"}
        )

        self.assertEqual(self.for_rule(violations, "API_STORE_ESCAPE"), [])


class PolicyPurityTest(BoundaryRuleTestCase):
    def test_clock_in_policy_fails(self) -> None:
        violations = self.run_rules(
            {
                "domains/workspaces/retention_policy.rs": (
                    "fn decide() -> String {\n"
                    "    chrono::Utc::now().to_rfc3339()\n"
                    "}\n"
                )
            }
        )

        matches = self.for_rule(violations, "POLICY_PURITY")
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].lineno, 2)
        self.assertIn("facts in, decisions out", matches[0].message)

    def test_id_minting_in_policy_fails(self) -> None:
        violations = self.run_rules(
            {"domains/sessions/launch_policy.rs": "let id = Uuid::new_v4().to_string();\n"}
        )

        self.assertEqual(len(self.for_rule(violations, "POLICY_PURITY")), 1)

    def test_store_import_in_policy_fails(self) -> None:
        violations = self.run_rules(
            {
                "domains/plans/decide_policy.rs": (
                    "use crate::domains::plans::store::PlanStore;\n"
                    "use crate::adapters::git::GitService;\n"
                )
            }
        )

        self.assertEqual(len(self.for_rule(violations, "POLICY_PURITY")), 2)

    def test_pure_policy_passes(self) -> None:
        # `&self` on a plain data struct and a Display impl are NOT impurity;
        # the rule deliberately does not police them.
        violations = self.run_rules(
            {
                "domains/agents/installer/install_policy.rs": (
                    "use crate::domains::agents::model::ArtifactRole;\n"
                    "impl std::fmt::Display for Reason {\n"
                    "    fn fmt(&self, f: &mut std::fmt::Formatter<'_>)"
                    " -> std::fmt::Result { Ok(()) }\n"
                    "}\n"
                    "impl Plan {\n"
                    "    pub fn has_reinstalls(&self) -> bool { false }\n"
                    "}\n"
                    "pub fn plan(facts: &Facts) -> Option<Reason> { None }\n"
                )
            }
        )

        self.assertEqual(self.for_rule(violations, "POLICY_PURITY"), [])

    def test_live_model_import_in_policy_passes(self) -> None:
        # launch_policy.rs legally takes live model shapes as fact inputs.
        violations = self.run_rules(
            {
                "domains/sessions/runtime/launch_policy.rs": (
                    "use crate::live::sessions::model::{LaunchEnv, SessionLaunch};\n"
                )
            }
        )

        self.assertEqual(self.for_rule(violations, "POLICY_PURITY"), [])

    def test_non_policy_file_is_not_checked(self) -> None:
        violations = self.run_rules(
            {"domains/workspaces/service.rs": "let now = chrono::Utc::now();\n"}
        )

        self.assertEqual(self.for_rule(violations, "POLICY_PURITY"), [])


class DomainStoreImportTest(BoundaryRuleTestCase):
    def test_store_dir_importing_api_and_live_fails(self) -> None:
        violations = self.run_rules(
            {
                "domains/sessions/store/events.rs": (
                    "use crate::api::http::ApiError;\n"
                    "use crate::live::sessions::LiveSessionManager;\n"
                    "use crate::acp::permission_payload::permission_options;\n"
                )
            }
        )

        self.assertEqual(len(self.for_rule(violations, "DOMAIN_STORE_API_IMPORT")), 1)
        self.assertEqual(len(self.for_rule(violations, "DOMAIN_STORE_LIVE_IMPORT")), 2)

    def test_bare_store_rs_is_covered_too(self) -> None:
        # The generalized rule reaches every domain's store, not just sessions'.
        violations = self.run_rules(
            {"domains/plans/store.rs": "use crate::api::http::ApiError;\n"}
        )

        self.assertEqual(len(self.for_rule(violations, "DOMAIN_STORE_API_IMPORT")), 1)

    def test_session_specific_rule_ids_are_gone(self) -> None:
        violations = self.run_rules(
            {"domains/sessions/store/events.rs": "use crate::api::http::ApiError;\n"}
        )

        self.assertNotIn("SESSION_STORE_API_IMPORT", self.rule_ids(violations))
        self.assertNotIn("SESSION_STORE_LIVE_IMPORT", self.rule_ids(violations))

    def test_clean_store_passes(self) -> None:
        violations = self.run_rules(
            {
                "domains/plans/store.rs": (
                    "use crate::domains::plans::model::PlanRecord;\n"
                    "use crate::persistence::Db;\n"
                )
            }
        )

        self.assertEqual(violations, [])


class DomainContractImportTest(BoundaryRuleTestCase):
    def test_contract_import_fails(self) -> None:
        violations = self.run_rules(
            {"domains/goals/model.rs": "use anyharness_contract::v1::Goal;\n"}
        )

        matches = self.for_rule(violations, "DOMAIN_CONTRACT_IMPORT")
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].lineno, 1)
        self.assertIn("domain twin", matches[0].message)

    def test_multi_leaf_group_import_counts_once(self) -> None:
        violations = self.run_rules(
            {
                "domains/goals/runtime.rs": (
                    "use anyharness_contract::v1::{\n"
                    "    Goal, GoalStatus, GoalUpdatedPayload, SessionEventEnvelope,\n"
                    "};\n"
                )
            }
        )

        matches = self.for_rule(violations, "DOMAIN_CONTRACT_IMPORT")
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].lineno, 1)

    def test_two_import_lines_count_twice(self) -> None:
        violations = self.run_rules(
            {
                "domains/loops/runtime.rs": (
                    "use anyharness_contract::v1::Loop;\n"
                    "use crate::domains::loops::model::LoopRecord;\n"
                    "use anyharness_contract::v1::SessionEventEnvelope;\n"
                )
            }
        )

        matches = self.for_rule(violations, "DOMAIN_CONTRACT_IMPORT")
        self.assertEqual([violation.lineno for violation in matches], [1, 3])

    def test_request_response_rule_still_fires_alongside(self) -> None:
        # A single line can legitimately trigger both the narrow legacy rule and
        # the broad new one.
        violations = self.run_rules(
            {
                "domains/goals/runtime.rs": (
                    "use anyharness_contract::v1::SetSessionGoalRequest;\n"
                )
            }
        )

        self.assertEqual(len(self.for_rule(violations, "DOMAIN_CONTRACT_IMPORT")), 1)
        self.assertEqual(
            len(self.for_rule(violations, "DOMAIN_CONTRACT_REQUEST_RESPONSE")), 1
        )

    def test_contract_import_outside_domains_passes(self) -> None:
        violations = self.run_rules(
            {
                "api/http/goals.rs": "use anyharness_contract::v1::Goal;\n",
                "live/sessions/handle.rs": "use anyharness_contract::v1::SessionEvent;\n",
            }
        )

        self.assertEqual(self.for_rule(violations, "DOMAIN_CONTRACT_IMPORT"), [])

    def test_domain_local_imports_pass(self) -> None:
        violations = self.run_rules(
            {"domains/goals/model.rs": "use crate::domains::goals::wire::GoalWire;\n"}
        )

        self.assertEqual(violations, [])


class DomainSqlOutsideStoreTest(BoundaryRuleTestCase):
    def test_insert_outside_store_fails(self) -> None:
        violations = self.run_rules(
            {
                "domains/sessions/links/completions.rs": (
                    "fn queue(conn: &Connection) {\n"
                    '    conn.execute("INSERT INTO session_pending_prompts (id) VALUES (?1)",\n'
                    "        params![id])\n"
                    "}\n"
                )
            }
        )

        matches = self.for_rule(violations, "DOMAIN_SQL_OUTSIDE_STORE")
        self.assertEqual([violation.lineno for violation in matches], [2, 3])
        self.assertIn("domain's store", matches[0].message)

    def test_select_from_and_upsert_fail(self) -> None:
        violations = self.run_rules(
            {
                "domains/plans/service.rs": (
                    '    "SELECT * FROM plans WHERE id = ?1",\n'
                    "    ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at\n"
                    '    "DELETE FROM plans WHERE id = ?1",\n'
                )
            }
        )

        self.assertEqual(len(self.for_rule(violations, "DOMAIN_SQL_OUTSIDE_STORE")), 3)

    def test_sql_inside_store_passes(self) -> None:
        violations = self.run_rules(
            {
                "domains/plans/store.rs": (
                    '    conn.execute("INSERT INTO plans (id) VALUES (?1)", params![id]);\n'
                ),
                "domains/sessions/store/events.rs": (
                    '    conn.query_row("SELECT * FROM session_events WHERE id = ?1", [], f);\n'
                ),
            }
        )

        self.assertEqual(self.for_rule(violations, "DOMAIN_SQL_OUTSIDE_STORE"), [])

    def test_prose_and_log_strings_are_not_sql(self) -> None:
        violations = self.run_rules(
            {
                "domains/workspaces/service.rs": (
                    '    tracing::info!("select a workspace from the roster");\n'
                    '    let label = "Update settings";\n'
                    "    // INSERT INTO used to happen here; moved to the store\n"
                    "    let selected = pick_from(&candidates);\n"
                )
            }
        )

        self.assertEqual(self.for_rule(violations, "DOMAIN_SQL_OUTSIDE_STORE"), [])

    def test_sql_outside_domains_passes(self) -> None:
        violations = self.run_rules(
            {
                "persistence/migrations.rs": (
                    '    conn.execute("CREATE TABLE plans (id TEXT)", []);\n'
                )
            }
        )

        self.assertEqual(self.for_rule(violations, "DOMAIN_SQL_OUTSIDE_STORE"), [])


class AllowlistRatchetTest(unittest.TestCase):
    def make_violations(self, rule_id: str, path: str, count: int) -> list[check_module.Violation]:
        return [
            check_module.Violation(rule_id, Path(path), lineno, "message")
            for lineno in range(1, count + 1)
        ]

    def allowlist(self, *rows: tuple[str, str, int]) -> dict[tuple[str, str], object]:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory).resolve() / "allowlist.txt"
            path.write_text(
                "# header\n"
                + "".join(f"{rule} {rel} {count} seeded debt\n" for rule, rel, count in rows),
                encoding="utf-8",
            )
            return check_module.load_allowlist(allowlist_path=path)

    def test_count_at_the_allowed_number_passes(self) -> None:
        rel = "anyharness/crates/anyharness-lib/src/domains/mobility/service.rs"
        allowlist = self.allowlist(("DOMAIN_LIVE_VALVE", rel, 2))
        violations = self.make_violations("DOMAIN_LIVE_VALVE", rel, 2)

        failures, stale = check_module.apply_allowlist(violations, allowlist)

        self.assertEqual(failures, [])
        self.assertEqual(stale, [])

    def test_over_count_fails(self) -> None:
        rel = "anyharness/crates/anyharness-lib/src/domains/mobility/service.rs"
        allowlist = self.allowlist(("DOMAIN_LIVE_VALVE", rel, 2))
        violations = self.make_violations("DOMAIN_LIVE_VALVE", rel, 3)

        failures, stale = check_module.apply_allowlist(violations, allowlist)

        self.assertEqual(len(failures), 1)
        self.assertEqual(failures[0].rule_id, "DOMAIN_LIVE_VALVE")
        self.assertEqual(stale, [])

    def test_unallowlisted_rule_fails(self) -> None:
        rel = "anyharness/crates/anyharness-lib/src/api/http/hosting.rs"
        violations = self.make_violations("API_STORE_ESCAPE", rel, 1)

        failures, stale = check_module.apply_allowlist(violations, {})

        self.assertEqual(len(failures), 1)
        self.assertEqual(stale, [])

    def test_stale_count_is_reported(self) -> None:
        rel = "anyharness/crates/anyharness-lib/src/domains/plans/service.rs"
        allowlist = self.allowlist(("DOMAIN_SQL_OUTSIDE_STORE", rel, 4))
        violations = self.make_violations("DOMAIN_SQL_OUTSIDE_STORE", rel, 1)

        failures, stale = check_module.apply_allowlist(violations, allowlist)

        self.assertEqual(failures, [])
        self.assertEqual(len(stale), 1)
        self.assertIn("stale allowlist count", stale[0])
        self.assertIn("observed 1, allowed 4", stale[0])

    def test_fully_cleaned_entry_is_reported_stale(self) -> None:
        rel = "anyharness/crates/anyharness-lib/src/live/sessions/probe.rs"
        allowlist = self.allowlist(("LIVE_DOMAIN_STORE_IMPORT", rel, 1))

        failures, stale = check_module.apply_allowlist([], allowlist)

        self.assertEqual(failures, [])
        self.assertEqual(len(stale), 1)
        self.assertIn("observed 0, allowed 1", stale[0])

    def test_malformed_allowlist_line_raises(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory).resolve() / "allowlist.txt"
            path.write_text("DOMAIN_LIVE_VALVE some/path\n", encoding="utf-8")

            with self.assertRaises(ValueError) as caught:
                check_module.load_allowlist(allowlist_path=path)

        self.assertIn("expected RULE_ID path count reason", str(caught.exception))

    def test_zero_count_raises(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory).resolve() / "allowlist.txt"
            path.write_text("DOMAIN_LIVE_VALVE some/path 0 reason\n", encoding="utf-8")

            with self.assertRaises(ValueError) as caught:
                check_module.load_allowlist(allowlist_path=path)

        self.assertIn("count must be positive", str(caught.exception))


class ShippedAllowlistTest(unittest.TestCase):
    def test_repo_allowlist_covers_the_repo_exactly(self) -> None:
        """The checked-in allowlist is a ratchet: no failures and no stale rows."""
        allowlist = check_module.load_allowlist()
        violations = check_module.collect_violations()

        failures, stale = check_module.apply_allowlist(violations, allowlist)

        self.assertEqual([violation.format() for violation in failures], [])
        self.assertEqual(stale, [])

    def test_mobility_service_is_valved(self) -> None:
        """Calibration anchor: this file must stay visible to the valve rule."""
        violations = check_module.collect_violations()
        flagged = {
            violation.relative_path
            for violation in violations
            if violation.rule_id == "DOMAIN_LIVE_VALVE"
        }

        self.assertIn(
            "anyharness/crates/anyharness-lib/src/domains/mobility/service.rs", flagged
        )


if __name__ == "__main__":
    unittest.main()
