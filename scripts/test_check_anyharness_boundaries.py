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

    def test_app_state_store_field_access_fails(self) -> None:
        # No store type is named on the line, so neither the import pass nor the
        # ctor/accessor patterns see it — the field name is the only signal.
        violations = self.run_rules(
            {
                "api/http/health.rs": (
                    "async fn health(state: AppState) -> Json<HealthResponse> {\n"
                    "    Json(HealthResponse {\n"
                    "        agent_seed: state.agent_seed_store.health(),\n"
                    "    })\n"
                    "}\n"
                )
            }
        )

        matches = self.for_rule(violations, "API_STORE_ESCAPE")
        self.assertEqual([violation.lineno for violation in matches], [3])
        self.assertIn("facade", matches[0].message)

    def test_non_store_app_state_fields_pass(self) -> None:
        violations = self.run_rules(
            {
                "api/http/workspaces.rs": (
                    "async fn handler(state: AppState) {\n"
                    "    state.foo.list();\n"
                    "    state.db.execution_store_id();\n"
                    "    state.workspace_runtime.start().await;\n"
                    "    state.runtime_home.display();\n"
                    "    state.storefront.render();\n"
                    "}\n"
                )
            }
        )

        self.assertEqual(self.for_rule(violations, "API_STORE_ESCAPE"), [])

    def test_app_state_store_field_outside_api_passes(self) -> None:
        # The rule is about handlers reaching past the facade; app/ wires the
        # store into AppState in the first place.
        violations = self.run_rules(
            {"app/mod.rs": "    let health = state.agent_seed_store.health();\n"}
        )

        self.assertEqual(self.for_rule(violations, "API_STORE_ESCAPE"), [])


class LiveDomainStoreLinePassTest(BoundaryRuleTestCase):
    """live/** can reach a store inline, with no import to catch."""

    def test_inline_store_constructor_in_live_fails(self) -> None:
        violations = self.run_rules(
            {
                "live/sessions/background_work/mod.rs": (
                    "fn seeded() -> SessionStore {\n"
                    "    let store = SessionStore::new(db);\n"
                    "    store\n"
                    "}\n"
                )
            }
        )

        matches = self.for_rule(violations, "LIVE_DOMAIN_STORE_IMPORT")
        self.assertEqual([violation.lineno for violation in matches], [2])
        self.assertIn("never fetches", matches[0].message)

    def test_inline_store_accessor_in_live_fails(self) -> None:
        violations = self.run_rules(
            {"live/terminals/manager.rs": "    let rows = self.ports.store().list()?;\n"}
        )

        self.assertEqual(len(self.for_rule(violations, "LIVE_DOMAIN_STORE_IMPORT")), 1)

    def test_live_use_line_is_not_double_counted(self) -> None:
        # The import pass already counts this statement; the line pass must not.
        violations = self.run_rules(
            {
                "live/sessions/probe.rs": (
                    "use crate::domains::sessions::store::SessionStore;\n"
                )
            }
        )

        self.assertEqual(len(self.for_rule(violations, "LIVE_DOMAIN_STORE_IMPORT")), 1)

    def test_clean_live_file_passes(self) -> None:
        violations = self.run_rules(
            {
                "live/sessions/driver/mod.rs": (
                    "fn drive(facts: LaunchBundle) {\n"
                    "    facts.apply();\n"
                    "}\n"
                )
            }
        )

        self.assertEqual(self.for_rule(violations, "LIVE_DOMAIN_STORE_IMPORT"), [])

    def test_inline_store_outside_live_passes(self) -> None:
        violations = self.run_rules(
            {"domains/sessions/service.rs": "    let store = SessionStore::new(db);\n"}
        )

        self.assertEqual(self.for_rule(violations, "LIVE_DOMAIN_STORE_IMPORT"), [])


class DomainValveLiveReexportTest(BoundaryRuleTestCase):
    """A valve may hold live powers; re-exporting one republishes it domain-wide."""

    def test_valve_reexporting_live_power_fails(self) -> None:
        violations = self.run_rules(
            {
                "domains/sessions/runtime.rs": (
                    "pub use crate::live::sessions::LiveSessionManager;\n"
                )
            }
        )

        matches = self.for_rule(violations, "DOMAIN_VALVE_LIVE_REEXPORT")
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].lineno, 1)
        self.assertIn("re-export", matches[0].message)

    def test_valve_reexporting_live_model_shape_passes(self) -> None:
        # The observer-trait inversion: model shapes are sanctioned everywhere the
        # valve rule allows them, so re-exporting one is not laundering a power.
        violations = self.run_rules(
            {
                "domains/sessions/runtime.rs": (
                    "pub use crate::live::sessions::model::LiveSessionSnapshot;\n"
                )
            }
        )

        self.assertEqual(self.for_rule(violations, "DOMAIN_VALVE_LIVE_REEXPORT"), [])

    def test_private_use_in_valve_passes(self) -> None:
        # Holding the power is the valve's whole job; only republishing is banned.
        violations = self.run_rules(
            {
                "domains/sessions/runtime.rs": (
                    "use crate::live::sessions::LiveSessionManager;\n"
                )
            }
        )

        self.assertEqual(self.for_rule(violations, "DOMAIN_VALVE_LIVE_REEXPORT"), [])

    def test_rule_covers_every_valve_shape(self) -> None:
        violations = self.run_rules(
            {
                "domains/goals/runtime.rs": (
                    "pub use crate::live::sessions::LiveSessionManager;\n"
                ),
                "domains/sessions/live_ports.rs": (
                    "pub use crate::live::sessions::handle::LiveSessionHandle;\n"
                ),
                "domains/workspaces/runtime/mod.rs": (
                    "pub use crate::live::terminals::TerminalService;\n"
                ),
            }
        )

        self.assertEqual(len(self.for_rule(violations, "DOMAIN_VALVE_LIVE_REEXPORT")), 3)

    def test_group_reexport_counts_once(self) -> None:
        violations = self.run_rules(
            {
                "domains/sessions/runtime.rs": (
                    "pub use crate::live::sessions::{\n"
                    "    LiveSessionHandle,\n"
                    "    LiveSessionManager,\n"
                    "};\n"
                )
            }
        )

        matches = self.for_rule(violations, "DOMAIN_VALVE_LIVE_REEXPORT")
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].lineno, 1)

    def test_pub_use_split_across_lines_still_fires(self) -> None:
        # The `pub use` keyword and its path can sit on separate lines. Matching
        # the prefix against only the first line let this spelling launder a live
        # power silently.
        violations = self.run_rules(
            {
                "domains/sessions/runtime.rs": (
                    "pub use\n    crate::live::sessions::LiveSessionHandle;\n"
                )
            }
        )

        matches = self.for_rule(violations, "DOMAIN_VALVE_LIVE_REEXPORT")
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].lineno, 1)

    def test_split_pub_use_of_model_shape_still_passes(self) -> None:
        # The split spelling must not smuggle the `::model` exemption away either.
        violations = self.run_rules(
            {
                "domains/sessions/runtime.rs": (
                    "pub use\n    crate::live::sessions::model::LiveSessionSnapshot;\n"
                )
            }
        )

        self.assertEqual(self.for_rule(violations, "DOMAIN_VALVE_LIVE_REEXPORT"), [])

    def test_split_private_use_still_passes(self) -> None:
        # Splitting a private `use` does not turn it into a re-export.
        violations = self.run_rules(
            {
                "domains/sessions/runtime.rs": (
                    "use\n    crate::live::sessions::LiveSessionManager;\n"
                )
            }
        )

        self.assertEqual(self.for_rule(violations, "DOMAIN_VALVE_LIVE_REEXPORT"), [])

    def test_restricted_pub_visibilities_fire(self) -> None:
        # `pub(crate)`, `pub(super)` and `pub(in ..)` all republish beyond the
        # valve module, so each is laundering.
        for visibility in ["pub(crate)", "pub(super)", "pub(in crate::domains)"]:
            with self.subTest(visibility=visibility):
                violations = self.run_rules(
                    {
                        "domains/sessions/runtime.rs": (
                            f"{visibility} use crate::live::sessions::LiveSessionManager;\n"
                        )
                    }
                )

                self.assertEqual(
                    len(self.for_rule(violations, "DOMAIN_VALVE_LIVE_REEXPORT")), 1
                )

    def test_non_valve_domain_file_is_not_checked_by_this_rule(self) -> None:
        # A non-valve file re-exporting live is already a DOMAIN_LIVE_VALVE hit;
        # this rule exists for the files that rule cannot see.
        violations = self.run_rules(
            {
                "domains/sessions/hooks.rs": (
                    "pub use crate::live::sessions::LiveSessionManager;\n"
                )
            }
        )

        self.assertEqual(self.for_rule(violations, "DOMAIN_VALVE_LIVE_REEXPORT"), [])
        self.assertEqual(len(self.for_rule(violations, "DOMAIN_LIVE_VALVE")), 1)


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

    def test_bare_policy_rs_is_a_policy_file(self) -> None:
        # `policy.rs` is the same thing as `*_policy.rs` by role and by name; the
        # suffix test alone missed it.
        violations = self.run_rules(
            {
                "domains/workflows/control/policy.rs": (
                    "use crate::domains::workflows::store::WorkflowRunStore;\n"
                    "pub struct WorkflowSessionControllerPolicy {\n"
                    "    store: WorkflowRunStore,\n"
                    "}\n"
                )
            }
        )

        matches = self.for_rule(violations, "POLICY_PURITY")
        self.assertEqual([violation.lineno for violation in matches], [1])
        self.assertIn("no store", matches[0].message)

    def test_suffix_policy_files_still_matched(self) -> None:
        violations = self.run_rules(
            {
                "domains/workspaces/retention_policy.rs": (
                    "let now = chrono::Utc::now();\n"
                ),
                "domains/agents/installer/install_policy.rs": (
                    "let id = Uuid::new_v4();\n"
                ),
            }
        )

        self.assertEqual(len(self.for_rule(violations, "POLICY_PURITY")), 2)

    def test_policy_rs_outside_domains_is_not_checked(self) -> None:
        violations = self.run_rules(
            {"adapters/git/policy.rs": "let now = chrono::Utc::now();\n"}
        )

        self.assertEqual(self.for_rule(violations, "POLICY_PURITY"), [])

    def test_bare_policy_rs_purity_patterns_fire(self) -> None:
        violations = self.run_rules(
            {"domains/workflows/control/policy.rs": "let now = Utc::now();\n"}
        )

        self.assertEqual(len(self.for_rule(violations, "POLICY_PURITY")), 1)


class DomainStoreImportTest(BoundaryRuleTestCase):
    def test_store_dir_importing_api_and_live_fails(self) -> None:
        violations = self.run_rules(
            {
                "domains/sessions/store/events.rs": (
                    "use crate::api::http::ApiError;\n"
                    "use crate::live::sessions::LiveSessionManager;\n"
                    "use crate::integrations::acp::permission_payload::permission_options;\n"
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

    def test_root_brace_group_import_counts_once(self) -> None:
        # `use {` puts the leaf on a continuation line that carries no `use`
        # prefix. Guarding the line pass by "is a use-statement head" let the
        # inline pass fire on line 2 while the import pass fired on line 1,
        # counting one import twice.
        violations = self.run_rules(
            {
                "domains/goals/runtime.rs": (
                    "use {\n    anyharness_contract::v1::Goal,\n};\n"
                )
            }
        )

        matches = self.for_rule(violations, "DOMAIN_CONTRACT_IMPORT")
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].lineno, 1)

    def test_root_brace_group_pub_use_counts_once(self) -> None:
        violations = self.run_rules(
            {
                "domains/goals/runtime.rs": (
                    "pub use {\n    anyharness_contract::v1::Goal,\n};\n"
                )
            }
        )

        self.assertEqual(len(self.for_rule(violations, "DOMAIN_CONTRACT_IMPORT")), 1)

    def test_inline_contract_path_below_a_use_statement_still_fires(self) -> None:
        # Skipping use-statement lines must not spill over into ordinary code:
        # the fn signature on line 3 is a genuine inline path.
        violations = self.run_rules(
            {
                "domains/goals/service.rs": (
                    "use {\n    crate::domains::goals::model::GoalRecord,\n};\n"
                    "fn map(input: anyharness_contract::v1::Goal) -> GoalRecord {}\n"
                )
            }
        )

        matches = self.for_rule(violations, "DOMAIN_CONTRACT_IMPORT")
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].lineno, 4)

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

    def test_inline_contract_path_fails(self) -> None:
        # No use statement declares these, so the import-only pass saw nothing.
        violations = self.run_rules(
            {
                "domains/sessions/store/events.rs": (
                    "fn append(\n"
                    "    event: anyharness_contract::v1::SessionEvent,\n"
                    ") -> Result<anyharness_contract::v1::SessionEventEnvelope> {\n"
                    "    todo!()\n"
                    "}\n"
                )
            }
        )

        matches = self.for_rule(violations, "DOMAIN_CONTRACT_IMPORT")
        self.assertEqual([violation.lineno for violation in matches], [2, 3])
        self.assertIn("domain twin", matches[0].message)

    def test_inline_contract_turbofish_fails(self) -> None:
        violations = self.run_rules(
            {
                "domains/sessions/store/events.rs": (
                    "    let event ="
                    " serde_json::from_str::<anyharness_contract::v1::SessionEvent>(json);\n"
                )
            }
        )

        self.assertEqual(len(self.for_rule(violations, "DOMAIN_CONTRACT_IMPORT")), 1)

    def test_use_line_is_not_double_counted_by_the_line_pass(self) -> None:
        # The use-statement pass already counts this; the inline pass must skip it.
        violations = self.run_rules(
            {
                "domains/goals/model.rs": (
                    "use anyharness_contract::v1::GoalRecord;\n"
                )
            }
        )

        self.assertEqual(len(self.for_rule(violations, "DOMAIN_CONTRACT_IMPORT")), 1)

    def test_pub_use_contract_reexport_is_not_double_counted(self) -> None:
        violations = self.run_rules(
            {
                "domains/goals/wire.rs": (
                    "pub use anyharness_contract::v1::GoalRecord;\n"
                )
            }
        )

        self.assertEqual(len(self.for_rule(violations, "DOMAIN_CONTRACT_IMPORT")), 1)

    def test_multi_line_use_statement_counts_once_with_inline_pass_active(self) -> None:
        violations = self.run_rules(
            {
                "domains/goals/model.rs": (
                    "use anyharness_contract::v1::{\n"
                    "    GoalRecord,\n"
                    "    GoalStatus,\n"
                    "};\n"
                )
            }
        )

        matches = self.for_rule(violations, "DOMAIN_CONTRACT_IMPORT")
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].lineno, 1)

    def test_commented_inline_contract_path_is_ignored(self) -> None:
        violations = self.run_rules(
            {
                "domains/goals/service.rs": (
                    "    // was: anyharness_contract::v1::GoalRecord, now a twin\n"
                )
            }
        )

        self.assertEqual(self.for_rule(violations, "DOMAIN_CONTRACT_IMPORT"), [])

    def test_inline_contract_path_outside_domains_passes(self) -> None:
        violations = self.run_rules(
            {
                "api/http/goals.rs": (
                    "fn map(record: anyharness_contract::v1::GoalRecord) {}\n"
                )
            }
        )

        self.assertEqual(self.for_rule(violations, "DOMAIN_CONTRACT_IMPORT"), [])


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

    def test_multi_line_update_is_caught(self) -> None:
        # The dominant real shape: rustfmt puts the verb, the SET and the WHERE on
        # separate lines, so no line carries two keywords.
        violations = self.run_rules(
            {
                "domains/sessions/links/completions.rs": (
                    "fn bump(tx: &Transaction) {\n"
                    "    tx.execute(\n"
                    '        "UPDATE sessions\n'
                    "         SET pending_prompt_seq_cursor = pending_prompt_seq_cursor + 1\n"
                    '         WHERE id = ?1",\n'
                    "    )\n"
                    "}\n"
                )
            }
        )

        matches = self.for_rule(violations, "DOMAIN_SQL_OUTSIDE_STORE")
        # The verb head and the SET clause; the bare WHERE line is not a keyword we
        # anchor on, because it never heads a statement.
        self.assertEqual([violation.lineno for violation in matches], [3, 4])

    def test_multi_line_select_head_is_caught(self) -> None:
        violations = self.run_rules(
            {
                "domains/workspaces/retention_policy.rs": (
                    "fn get(conn: &Connection) {\n"
                    "    conn.query_row(\n"
                    '        "SELECT max_materialized_worktrees_per_repo, updated_at\n'
                    "           FROM worktree_retention_policy\n"
                    '          WHERE id = 1",\n'
                    "    )\n"
                    "}\n"
                )
            }
        )

        matches = self.for_rule(violations, "DOMAIN_SQL_OUTSIDE_STORE")
        self.assertEqual([violation.lineno for violation in matches], [3])

    def test_single_line_sql_still_caught(self) -> None:
        # The one-line shapes the original patterns covered must keep firing, and
        # must not double-count now that keyword-anchored patterns exist too.
        violations = self.run_rules(
            {
                "domains/plans/service.rs": (
                    '    conn.execute("UPDATE plans SET name = ?2 WHERE id = ?1", []);\n'
                    '    conn.query_row("SELECT * FROM plans WHERE id = ?1", [], f);\n'
                )
            }
        )

        matches = self.for_rule(violations, "DOMAIN_SQL_OUTSIDE_STORE")
        self.assertEqual([violation.lineno for violation in matches], [1, 2])

    def test_conflict_resolving_insert_and_drop_are_caught(self) -> None:
        violations = self.run_rules(
            {
                "domains/sessions/links/completions.rs": (
                    '    "INSERT OR IGNORE INTO session_link_wake_schedules (id)\n'
                    '    conn.execute("DROP TABLE workspace_access_modes", [])?;\n'
                )
            }
        )

        self.assertEqual(len(self.for_rule(violations, "DOMAIN_SQL_OUTSIDE_STORE")), 2)

    def test_lowercase_prose_keywords_are_not_sql(self) -> None:
        # The keyword-anchored patterns are uppercase-only precisely so English
        # prose and log strings cannot trip them.
        violations = self.run_rules(
            {
                "domains/workspaces/service.rs": (
                    '    tracing::info!("select the agent for this workspace");\n'
                    '    let msg = "update the retention setting";\n'
                    "    let set = compute_set();\n"
                    '    tracing::warn!("could not update policy");\n'
                    "    let selected = pick_from(&candidates);\n"
                )
            }
        )

        self.assertEqual(self.for_rule(violations, "DOMAIN_SQL_OUTSIDE_STORE"), [])

    def test_uppercase_prose_and_do_update_fragments_are_not_double_counted(self) -> None:
        violations = self.run_rules(
            {
                "domains/workflows/service.rs": (
                    "    // run UPDATE both stamps the intent and increments the counter\n"
                    "    let mode = Method::UPDATE;\n"
                )
            }
        )

        self.assertEqual(self.for_rule(violations, "DOMAIN_SQL_OUTSIDE_STORE"), [])

    def test_bare_select_keyword_literals_do_not_match(self) -> None:
        # `"SELECT"` as an entire string literal is a keyword constant or a serde
        # rename, never a query. The `(?!")` exclusion covers exactly that shape.
        violations = self.run_rules(
            {
                "domains/workflows/service.rs": (
                    '    const KEYWORD: &str = "SELECT";\n'
                    '    #[serde(rename = "SELECT")]\n'
                )
            }
        )

        self.assertEqual(self.for_rule(violations, "DOMAIN_SQL_OUTSIDE_STORE"), [])

    def test_built_query_fragment_still_matches(self) -> None:
        # The exclusion must stay narrow: `"SELECT "` with trailing space is a
        # real query being concatenated, so it must keep matching.
        violations = self.run_rules(
            {
                "domains/workflows/service.rs": (
                    '    let sql = "SELECT ".to_string() + &columns;\n'
                )
            }
        )

        self.assertEqual(len(self.for_rule(violations, "DOMAIN_SQL_OUTSIDE_STORE")), 1)

    def test_bare_select_head_in_raw_string_still_matches(self) -> None:
        # A lone `SELECT` at line end inside a raw string is how the real
        # migrations spell a split query; it must not be swept up by the
        # keyword-literal exclusion.
        violations = self.run_rules(
            {"domains/workflows/service.rs": "        SELECT\n            id\n"}
        )

        self.assertEqual(len(self.for_rule(violations, "DOMAIN_SQL_OUTSIDE_STORE")), 1)

    def test_known_limitation_uppercase_verb_in_message_string_matches(self) -> None:
        # PINNED LIMITATION, not desired behaviour: `"UPDATE failed .."` is
        # lexically identical to `"UPDATE sessions .."`, so no regex can tell them
        # apart. Such a hit is a seedable false positive. If this test ever starts
        # failing because the match disappeared, confirm real split UPDATEs are
        # still caught before celebrating.
        violations = self.run_rules(
            {
                "domains/workflows/service.rs": (
                    '    anyhow::bail!("UPDATE failed for session {id}");\n'
                )
            }
        )

        self.assertEqual(len(self.for_rule(violations, "DOMAIN_SQL_OUTSIDE_STORE")), 1)

    def test_known_limitation_sql_in_block_comment_matches(self) -> None:
        # PINNED LIMITATION: strip_line_comment only understands `//`, so SQL
        # inside a `/* .. */` block is scanned as code.
        violations = self.run_rules(
            {
                "domains/workflows/service.rs": (
                    "    /*\n"
                    "     * SELECT * FROM workflow_runs WHERE id = ?1\n"
                    "     */\n"
                )
            }
        )

        self.assertEqual(len(self.for_rule(violations, "DOMAIN_SQL_OUTSIDE_STORE")), 1)


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

    def test_a_live_holding_service_is_valved(self) -> None:
        """Calibration anchor: a live-holding non-valve file stays visible.

        The original anchor was `domains/mobility/service.rs`; grid PR 6a moved
        its live power into `domains/mobility/runtime/`, so the anchor moved to
        the next real offender rather than being deleted. The paired assertion
        below is the other half: the new valve must NOT be flagged even though
        it holds the very same `crate::live::terminals` import.
        """
        violations = check_module.collect_violations()
        flagged = {
            violation.relative_path
            for violation in violations
            if violation.rule_id == "DOMAIN_LIVE_VALVE"
        }
        prefix = "anyharness/crates/anyharness-lib/src"

        self.assertIn(f"{prefix}/domains/agents/auth/login_terminal.rs", flagged)
        self.assertNotIn(f"{prefix}/domains/mobility/runtime/mod.rs", flagged)
        self.assertNotIn(f"{prefix}/domains/mobility/service.rs", flagged)

    def test_known_truths_the_hardened_rules_must_see(self) -> None:
        """Calibration anchors for the four rules widened after review.

        Each entry is a real offender the pre-hardening rule was blind to, so a
        regression that narrows a pattern back fails here and not just as a count.
        """
        violations = check_module.collect_violations()
        flagged = {
            (violation.rule_id, violation.relative_path, violation.lineno)
            for violation in violations
        }
        prefix = "anyharness/crates/anyharness-lib/src"

        for rule_id, path, lineno, why in [
            # Multi-line embedded SQL: a format!-built SELECT head, FROM on the
            # same interpolated line but still caught by the bare-SELECT-head
            # pattern (not just the single-line SELECT...FROM pattern), so this
            # anchor stays meaningful even though the head and FROM did not
            # split across lines here. Repointed from
            # sessions/links/completions.rs (grid plan PR 5b folded that file's
            # SQL into domains/sessions/store/link_completions.rs, which is
            # exempt as store code); this and the DROP TABLE anchor below are
            # now the only two real DOMAIN_SQL_OUTSIDE_STORE offenders left in
            # the repo, both engine-invisible cfg(test) boundaries later PRs
            # still own.
            # 159 -> 156: R5 dropped the now-dead SessionDeleteWorkflow argument
            # from this fixture's WorkspaceDeleteWorkflow construction, which
            # sits above the anchor. Same offender, same rule.
            ("DOMAIN_SQL_OUTSIDE_STORE",
             "domains/workflows/workspace_materialization/test_support.rs", 156,
             "format!-built SELECT COUNT(*) head"),
            # A DROP TABLE line, inside a cfg(test) mod the engine cannot see
            # past — the checker still flags the line itself. Carried forward
            # 324 -> 332 as the archiving rungs grew the file above it (R1's
            # retired-arm absorption, R4's WorkspaceArchived rename and its
            # archived-row admission tests); the offender and the rule that
            # sees it are unchanged. The anchor differs per rung because later
            # rungs edit the file, so each rung's branch pins its own value and
            # the restack takes each rung's own number on the one-line conflict.
            ("DOMAIN_SQL_OUTSIDE_STORE", "domains/workspaces/access_gate.rs", 332,
             "DROP TABLE line"),
            # A `state.*_store` field access, which carries no store type on the
            # line for the import pass to see. This particular one is benign (an
            # in-memory health snapshot), but the shape is what the rule watches.
            ("API_STORE_ESCAPE", "api/http/health.rs", 37, "AppState store field"),
            # An inline contract path with no use statement to declare it.
            ("DOMAIN_CONTRACT_IMPORT", "domains/sessions/store/events.rs", 75,
             "inline contract path"),
            # A store-holding file named exactly policy.rs.
            ("POLICY_PURITY", "domains/workflows/control/policy.rs", 8,
             "bare policy.rs"),
        ]:
            with self.subTest(rule=rule_id, path=path, why=why):
                self.assertIn((rule_id, f"{prefix}/{path}", lineno), flagged)

    def test_valve_live_reexport_rule_has_no_debt(self) -> None:
        """DOMAIN_VALVE_LIVE_REEXPORT landed clean; it must stay at zero."""
        violations = check_module.collect_violations()

        self.assertEqual(
            [
                violation.format()
                for violation in violations
                if violation.rule_id == "DOMAIN_VALVE_LIVE_REEXPORT"
            ],
            [],
        )


if __name__ == "__main__":
    unittest.main()
