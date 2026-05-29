use anyharness_contract::v1::ProposedPlanDecisionState;

use crate::domains::plans::model::PlanRecord;
use crate::domains::plans::service::PlanDecisionError;
use crate::live::sessions::LiveSessionCommandError;

use super::SessionRuntime;

impl SessionRuntime {
    pub async fn apply_plan_decision(
        &self,
        plan_id: &str,
        expected_version: i64,
        decision: ProposedPlanDecisionState,
    ) -> Result<PlanRecord, PlanDecisionError> {
        let plan = self
            .plan_service
            .get(plan_id)
            .map_err(PlanDecisionError::Store)?
            .ok_or(PlanDecisionError::NotFound)?;
        self.access_gate
            .assert_can_mutate_for_session(&plan.session_id)
            .map_err(|error| PlanDecisionError::Store(anyhow::anyhow!(error.to_string())))?;

        if let Some(handle) = self.acp_manager.get_handle(&plan.session_id).await {
            return handle
                .apply_plan_decision(plan_id.to_string(), expected_version, decision)
                .await
                .map_err(|error| match error {
                    LiveSessionCommandError::ActorUnavailable => PlanDecisionError::Store(
                        anyhow::anyhow!("session actor is not available for plan decision"),
                    ),
                    LiveSessionCommandError::ResponseDropped => PlanDecisionError::Store(
                        anyhow::anyhow!("session actor dropped plan decision response"),
                    ),
                    LiveSessionCommandError::Rejected(error) => error,
                });
        }

        let (plan, _) =
            self.plan_service
                .update_decision_offline(plan_id, expected_version, decision)?;
        Ok(plan)
    }
}
