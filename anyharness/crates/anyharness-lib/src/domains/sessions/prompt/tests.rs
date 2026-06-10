use std::collections::HashMap;

use agent_client_protocol as acp;
use anyharness_contract::v1::{ContentPart, PromptCapabilities, PromptInputBlock};

use super::prepare::prepare_prompt;
use super::render::{render, TurnPromptExtras};
use super::*;
use crate::domains::sessions::attachment_storage::PromptAttachmentStorage;
use crate::domains::sessions::model::PromptAttachmentState;
use crate::domains::sessions::plan_references::{PlanReferenceResolver, ResolvedPlanReference};
use crate::domains::sessions::store::SessionStore;
use crate::persistence::Db;

struct TestPlanResolver {
    plans: HashMap<String, ResolvedPlanReference>,
}

impl PlanReferenceResolver for TestPlanResolver {
    fn resolve_plan_reference(
        &self,
        plan_id: &str,
    ) -> anyhow::Result<Option<ResolvedPlanReference>> {
        Ok(self.plans.get(plan_id).cloned())
    }
}

#[test]
fn prepares_plan_reference_snapshot() {
    let (store, resolver) = fixture("workspace-1", "# Plan\n\nDo it.");
    let prepared = prepare_prompt(
        context(&store, &resolver, "workspace-1", true),
        vec![PromptInputBlock::PlanReference {
            plan_id: "plan-1".to_string(),
            snapshot_hash: "hash-1".to_string(),
        }],
    )
    .expect("prepare prompt");

    assert!(prepared.payload.has_content());
    assert_eq!(prepared.payload.text_summary, "[plan: Plan]");
    assert!(matches!(
        prepared.payload.blocks.as_slice(),
        [StoredPromptBlock::PlanReference { plan_id, as_resource: true, .. }]
            if plan_id == "plan-1"
    ));
    assert!(matches!(
        prepared.payload.content_parts().as_slice(),
        [ContentPart::PlanReference { plan_id, snapshot_hash, .. }]
            if plan_id == "plan-1" && snapshot_hash == "hash-1"
    ));
}

#[test]
fn rejects_missing_workspace_or_mismatched_snapshot() {
    let (store, resolver) = fixture("workspace-1", "# Plan\n\nDo it.");
    let missing = prepare_prompt(
        context(&store, &resolver, "workspace-2", false),
        vec![PromptInputBlock::PlanReference {
            plan_id: "plan-1".to_string(),
            snapshot_hash: "hash-1".to_string(),
        }],
    )
    .expect_err("workspace mismatch should be hidden as not found");
    assert_eq!(missing.code, "PROMPT_PLAN_NOT_FOUND");

    let mismatch = prepare_prompt(
        context(&store, &resolver, "workspace-1", false),
        vec![PromptInputBlock::PlanReference {
            plan_id: "plan-1".to_string(),
            snapshot_hash: "different".to_string(),
        }],
    )
    .expect_err("snapshot mismatch");
    assert_eq!(mismatch.code, "PROMPT_PLAN_SNAPSHOT_MISMATCH");
}

#[test]
fn dedupes_duplicate_plan_references() {
    let (store, resolver) = fixture("workspace-1", "# Plan\n\nDo it.");
    let prepared = prepare_prompt(
        context(&store, &resolver, "workspace-1", false),
        vec![
            PromptInputBlock::PlanReference {
                plan_id: "plan-1".to_string(),
                snapshot_hash: "hash-1".to_string(),
            },
            PromptInputBlock::PlanReference {
                plan_id: "plan-1".to_string(),
                snapshot_hash: "hash-1".to_string(),
            },
        ],
    )
    .expect("prepare prompt");

    assert_eq!(prepared.payload.blocks.len(), 1);
}

#[test]
fn enforces_plan_reference_byte_budget() {
    let (store, resolver) = fixture(
        "workspace-1",
        &"x".repeat(MAX_TOTAL_PLAN_REFERENCE_BYTES + 1),
    );
    let error = prepare_prompt(
        context(&store, &resolver, "workspace-1", false),
        vec![PromptInputBlock::PlanReference {
            plan_id: "plan-1".to_string(),
            snapshot_hash: "hash-1".to_string(),
        }],
    )
    .expect_err("plan reference too large");

    assert_eq!(error.code, "PROMPT_PLAN_REFERENCES_TOO_LARGE");
}

#[test]
fn converts_plan_reference_to_resource_or_text() {
    let (store, resolver) = fixture("workspace-1", "Do it.");
    let resource_payload = prepare_prompt(
        context(&store, &resolver, "workspace-1", true),
        vec![PromptInputBlock::PlanReference {
            plan_id: "plan-1".to_string(),
            snapshot_hash: "hash-1".to_string(),
        }],
    )
    .expect("prepare resource")
    .payload;
    let resource_blocks = render(
        &resource_payload,
        &ResolvedParts::default(),
        &TurnPromptExtras::default(),
    )
    .expect("render");
    assert!(matches!(
        resource_blocks.as_slice(),
        [acp::schema::ContentBlock::Resource(_)]
    ));

    let text_payload = prepare_prompt(
        context(&store, &resolver, "workspace-1", false),
        vec![PromptInputBlock::PlanReference {
            plan_id: "plan-1".to_string(),
            snapshot_hash: "hash-1".to_string(),
        }],
    )
    .expect("prepare text")
    .payload;
    let text_blocks = render(
        &text_payload,
        &ResolvedParts::default(),
        &TurnPromptExtras::default(),
    )
    .expect("render");
    assert!(matches!(
        text_blocks.as_slice(),
        [acp::schema::ContentBlock::Text(_)]
    ));
}

#[test]
fn persisted_prompt_provenance_rejects_invalid_kind_field_combinations() {
    let missing_source = PromptPayload::from_persisted(
        None,
        "hello",
        Some(r#"{"kind":"agent_session","label":"Parent"}"#),
    );
    assert_eq!(missing_source.provenance, None);

    let mixed_fields = PromptPayload::from_persisted(
        None,
        "hello",
        Some(r#"{"kind":"agent_session","sourceSessionId":"session-1","automationRunId":"run-1"}"#),
    );
    assert_eq!(mixed_fields.provenance, None);
}

fn context<'a>(
    store: &'a SessionStore,
    resolver: &'a TestPlanResolver,
    workspace_id: &'a str,
    embedded_context: bool,
) -> PromptPrepareContext<'a> {
    PromptPrepareContext {
        store,
        attachment_storage: test_attachment_storage(),
        session_id: "session-1",
        workspace_id,
        capabilities: PromptCapabilities {
            embedded_context,
            ..PromptCapabilities::default()
        },
        attachment_state: PromptAttachmentState::Pending,
        plan_resolver: resolver,
    }
}

fn test_attachment_storage() -> &'static PromptAttachmentStorage {
    Box::leak(Box::new(PromptAttachmentStorage::new(
        std::env::temp_dir().join(format!("anyharness-test-{}", uuid::Uuid::new_v4())),
    )))
}

fn fixture(workspace_id: &str, body_markdown: &str) -> (SessionStore, TestPlanResolver) {
    let store = SessionStore::new(Db::open_in_memory().expect("in-memory db"));
    let mut plans = HashMap::new();
    plans.insert(
        "plan-1".to_string(),
        ResolvedPlanReference {
            id: "plan-1".to_string(),
            workspace_id: workspace_id.to_string(),
            title: "Plan".to_string(),
            body_markdown: body_markdown.to_string(),
            snapshot_hash: "hash-1".to_string(),
            source_kind: "codex_turn_plan".to_string(),
            source_session_id: "session-1".to_string(),
            source_turn_id: Some("turn-1".to_string()),
            source_item_id: Some("item-1".to_string()),
            source_tool_call_id: None,
        },
    );
    (store, TestPlanResolver { plans })
}
