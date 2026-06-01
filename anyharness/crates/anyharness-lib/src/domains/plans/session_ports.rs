use super::model::PlanRecord;
use super::service::PlanService;
use crate::domains::sessions::plan_references::{
    PlanInteractionLinkResolver, PlanReferenceResolver, ResolvedPlanReference,
};

impl PlanReferenceResolver for PlanService {
    fn resolve_plan_reference(
        &self,
        plan_id: &str,
    ) -> anyhow::Result<Option<ResolvedPlanReference>> {
        Ok(self.get(plan_id)?.map(plan_reference_from_record))
    }
}

impl PlanInteractionLinkResolver for PlanService {
    fn has_linked_interaction(&self, session_id: &str, request_id: &str) -> anyhow::Result<bool> {
        Ok(self
            .store()
            .find_link_by_request(session_id, request_id)?
            .is_some())
    }
}

fn plan_reference_from_record(plan: PlanRecord) -> ResolvedPlanReference {
    ResolvedPlanReference {
        id: plan.id,
        workspace_id: plan.workspace_id,
        title: plan.title,
        body_markdown: plan.body_markdown,
        snapshot_hash: plan.snapshot_hash,
        source_session_id: plan.source_session_id,
        source_turn_id: plan.source_turn_id,
        source_item_id: plan.source_item_id,
        source_kind: plan.source_kind,
        source_tool_call_id: plan.source_tool_call_id,
    }
}
