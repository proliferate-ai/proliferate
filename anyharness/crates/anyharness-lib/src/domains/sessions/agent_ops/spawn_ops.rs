//! The one routine that brings a new agent into existence.
//!
//! `spawn_subagent` and `spawn_agent` differ in exactly one thing — what the
//! caller ends up owning — and ADR §3.3 makes that a parameter rather than a
//! second copy of the sequence. The sequence itself is delicate and was worth
//! having once: create the durable row, write the ownership row, arm the wake,
//! start the actor, dispatch the first prompt, and unwind everything on any
//! failure so a half-built agent never survives the call.
//!
//! `AgentSessionOwnership` is the only branch inside it, and it decides three
//! things at once, all of which follow from the same fact:
//!
//! | | Subagent | OwnedAgent |
//! | --- | --- | --- |
//! | link row | `relation = 'subagent'`, capped at insert | `relation = 'owned_agent'`, uncapped (ruling 9) |
//! | first prompt | a parent delegating (link-scoped provenance) | a peer talking (envelope, ADR §3.4) |
//! | wake | link-scoped, on the child's next completion | session-scoped and reply-consumable, the same row a `wakeOnReply` send arms |
//!
//! Everything else — inheritance of the caller's harness/model/mode, the
//! compensating cleanup, the shape of the result — is shared, which is the
//! point: the two spawn shapes cannot drift apart on the parts that are not
//! about ownership.

use crate::domains::agents::readiness::launch_options::{
    ResolvedLaunchAgentOption, ResolvedLaunchModelOption, ResolvedWorkspaceLaunchOptions,
};
use crate::domains::sessions::delegation::parent_to_child_provenance;
use crate::domains::sessions::links::model::{SessionLinkRecord, SessionLinkRelation};
use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
use crate::domains::sessions::ownership::service::AgentOwnershipService;
use crate::domains::sessions::prompt::envelope::{agent_message, AgentMessageSender};
use crate::domains::sessions::prompt::provenance::PromptProvenance;
use crate::domains::sessions::runtime::{SendPromptOutcome, SessionRuntime};
use crate::domains::sessions::store::agent_wakes::AgentWakeReason;
use crate::domains::sessions::subagents::service::SubagentService;
use crate::domains::sessions::wakes::service::AgentWakeService;
use crate::origin::OriginContext;

use super::calls_helpers::{cleanup_wake_schedule_after_failed_dispatch, initial_config_string};
use super::tools::{CreateSubagentArgs, SpawnAgentArgs};

/// What the caller owns once the agent exists — and therefore what the agent
/// IS. See the module docs for the three things it decides.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum AgentSessionOwnership {
    /// A linked subagent in the caller's own workspace: subordinate, capped,
    /// and taken down by the caller's own close.
    Subagent,
    /// A peer the caller owns outright. It is never "unpromoted": it has the
    /// full tool surface from birth, and nothing about it is subordinate
    /// except that the caller may close it.
    OwnedAgent,
}

impl AgentSessionOwnership {
    /// The `session_links.relation` an agent created under this mode must end
    /// up with. Everything downstream reads the relation and nothing else —
    /// `cascades_to_child`, the fanout subselect, `promote`'s refusal — so the
    /// mode and the stored row have to agree exactly.
    fn relation(self) -> SessionLinkRelation {
        match self {
            Self::Subagent => SessionLinkRelation::Subagent,
            Self::OwnedAgent => SessionLinkRelation::OwnedAgent,
        }
    }
}

/// A resolved request to create one agent. Building this is pure — it is the
/// arg-to-launch-config mapping and nothing else — which is why the two tools'
/// inheritance rules are testable without a runtime.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct CreateAgentSessionRequest {
    pub ownership: AgentSessionOwnership,
    /// Where the new agent lands. A subagent's is always the caller's own
    /// (ADR §5 flow 4: "subagents stay own-workspace only"); a peer's is
    /// whatever `spawn_agent` was asked for, which since `spawn_workspace`
    /// exists can be a workspace the caller just created.
    pub workspace_id: String,
    pub agent_kind: String,
    pub model_id: Option<String>,
    /// Whether `model_id` was NAMED by the caller or inherited from it. The
    /// two behave differently when the target workspace does not offer that
    /// model: a named model is an error, an inherited one is replaced by the
    /// target's default. See [`resolve_launch_against_target_workspace`].
    pub model_id_explicit: bool,
    pub mode_id: Option<String>,
    /// The same NAMED-vs-INHERITED distinction `model_id_explicit` draws, for
    /// the same reason: a mode the target does not offer is a refusal when the
    /// caller asked for it and a substitution when it only came along for the
    /// ride.
    pub mode_id_explicit: bool,
    pub label: Option<String>,
    pub prompt: String,
    pub wake_on_completion: bool,
}

/// A created, started, prompted agent.
pub(super) struct CreatedAgentSession {
    pub link: SessionLinkRecord,
    pub session: SessionRecord,
    /// `false` when no wake was asked for, or when one was already armed.
    pub wake_created: bool,
    pub prompt_outcome: SendPromptOutcome,
}

impl CreateAgentSessionRequest {
    /// Resolve `spawn_subagent`'s arguments against the parent session.
    ///
    /// Omitted harness/model/mode inherit the parent's CURRENT values, falling
    /// back to what it requested at launch — the behavior
    /// `get_subagent_launch_options` advertises as
    /// `"source": "current_parent_session"`.
    pub fn subagent(parent: &SessionRecord, args: CreateSubagentArgs) -> anyhow::Result<Self> {
        Self::inherit_from(
            parent,
            AgentSessionOwnership::Subagent,
            // Own workspace only, always. A subagent is subordinate to the
            // caller AND to the caller's checkout; `spawn_workspace` +
            // `spawn_agent` is the cross-workspace path (ADR §5 flow 4).
            parent.workspace_id.clone(),
            args.prompt,
            args.label,
            args.harness_id,
            args.initial_config.as_ref(),
            args.wake_on_completion,
        )
    }

    /// Resolve `spawn_agent`'s arguments against the calling session. The
    /// inheritance rule is deliberately the same one subagents get: an agent
    /// asking for a peer without naming a harness means "one like me".
    ///
    /// `workspaceId` names where the peer lands and defaults to the caller's
    /// own. Any workspace is allowed — that is the second half of ADR §5's
    /// flow 4, where `spawn_workspace` creates a workspace and `spawn_agent`
    /// puts an agent in it. Whether that workspace EXISTS, is standard, and is
    /// writable is not decided here: this mapping is pure, and the caller
    /// resolves and fences the target before `create_agent_session` runs.
    pub fn owned_agent(caller: &SessionRecord, args: SpawnAgentArgs) -> anyhow::Result<Self> {
        let target_workspace_id = args
            .workspace_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .unwrap_or_else(|| caller.workspace_id.clone());
        Self::inherit_from(
            caller,
            AgentSessionOwnership::OwnedAgent,
            target_workspace_id,
            args.prompt,
            args.label,
            args.harness_id,
            args.initial_config.as_ref(),
            args.wake_on_completion,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn inherit_from(
        caller: &SessionRecord,
        ownership: AgentSessionOwnership,
        workspace_id: String,
        prompt: String,
        label: Option<String>,
        harness_id: Option<String>,
        initial_config: Option<&serde_json::Value>,
        wake_on_completion: bool,
    ) -> anyhow::Result<Self> {
        if prompt.trim().is_empty() {
            anyhow::bail!("prompt is required");
        }
        let named_model_id = initial_config_string(initial_config, &["modelId", "model"]);
        let named_mode_id = initial_config_string(initial_config, &["modeId", "mode"]);
        Ok(Self {
            ownership,
            workspace_id,
            agent_kind: harness_id.unwrap_or_else(|| caller.agent_kind.clone()),
            model_id_explicit: named_model_id.is_some(),
            model_id: named_model_id
                .or_else(|| caller.current_model_id.clone())
                .or_else(|| caller.requested_model_id.clone()),
            mode_id_explicit: named_mode_id.is_some(),
            mode_id: named_mode_id
                .or_else(|| caller.current_mode_id.clone())
                .or_else(|| caller.requested_mode_id.clone()),
            label: label
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            prompt,
            wake_on_completion,
        })
    }

    /// Whether the new agent lands somewhere other than the caller's checkout.
    pub fn is_cross_workspace(&self, caller: &SessionRecord) -> bool {
        self.workspace_id != caller.workspace_id
    }

    /// Whether the new session may spawn agents of its own.
    ///
    /// A subagent may not — that is ruling 3, and the durable flag is the
    /// second half of the block the depth rule enforces. An owned agent may:
    /// it is a peer from birth, never "unpromoted", so withholding the flag
    /// would leave it permanently unable to do what a promoted agent can.
    fn child_subagents_enabled(&self) -> bool {
        match self.ownership {
            AgentSessionOwnership::Subagent => false,
            AgentSessionOwnership::OwnedAgent => true,
        }
    }
}

/// Resolve the launch selection against the workspace the agent will actually
/// run in — never the caller's (ADR §5 flow 4).
///
/// This is the spawn-side twin of `config_ops`' composition rule, and it exists
/// for the same reason: since `spawn_workspace`, the target workspace is
/// routinely NOT the caller's, and two workspaces can have entirely different
/// catalogs, readiness and auth contexts. Composing the caller's would let an
/// agent launch a harness or model the target machine cannot actually run
/// there, which fails later, at spawn, with a durable half-built session
/// already inserted.
///
/// All three selections are treated the same way, which is the point — the
/// target's universe decides, never the caller's:
///
/// - the harness is always refused when the target cannot launch it. There is
///   no sensible substitute — "one like me" is the request, and quietly picking
///   a different harness would be a different agent.
/// - a model the caller NAMED is refused for the same reason. A model merely
///   INHERITED from the caller is replaced by the target's own default: the
///   caller never asked for it, it only asked for "one like me", and the
///   target's default is exactly what the human create flow would pick there.
/// - the mode follows the model's rule exactly. Modes are a per-model control
///   (`ResolvedLaunchModelOption::modes`, from `controls.mode.values`), so a
///   NAMED mode the target's model does not list is refused and an INHERITED
///   one is replaced by that harness's curated default (`unattended_mode_id`),
///   or dropped when the harness declares none.
///
/// Two arms deliberately pass through rather than refuse, and they are the same
/// asymmetry: a target whose catalog resolves to NO launchable agents says
/// nothing about the request — readiness could not be established on this
/// machine — and a model that declares NO mode control says nothing about the
/// mode. Refusing on either would name nothing the caller could act on. The
/// cost is that an unresolvable workspace admits any harness/model/mode here;
/// they are re-checked at start, where the failure is specific.
///
/// The catalog arrives as a closure, so *which workspace id this asks about* is
/// testable without a runtime.
pub(super) fn resolve_launch_against_target_workspace<C>(
    request: &mut CreateAgentSessionRequest,
    resolve_workspace_launch_options: C,
) -> anyhow::Result<()>
where
    C: FnOnce(&str) -> anyhow::Result<ResolvedWorkspaceLaunchOptions>,
{
    let catalog = resolve_workspace_launch_options(&request.workspace_id)?;
    if catalog.agents.is_empty() {
        return Ok(());
    }
    let Some(agent) = catalog
        .agents
        .iter()
        .find(|agent| agent.kind == request.agent_kind)
    else {
        anyhow::bail!(
            "{} cannot be launched in workspace {}. Launchable there: {}.",
            request.agent_kind,
            request.workspace_id,
            join_quoted(catalog.agents.iter().map(|agent| agent.kind.as_str()))
        );
    };
    resolve_model_against_agent(request, agent)?;
    resolve_mode_against_agent(request, agent)
}

fn resolve_model_against_agent(
    request: &mut CreateAgentSessionRequest,
    agent: &ResolvedLaunchAgentOption,
) -> anyhow::Result<()> {
    let Some(model_id) = request.model_id.clone() else {
        return Ok(());
    };
    if find_model(agent, &model_id).is_some() {
        return Ok(());
    }
    if request.model_id_explicit {
        anyhow::bail!(
            "model {model_id:?} is not available for {} in workspace {}. Available there: {}.",
            request.agent_kind,
            request.workspace_id,
            join_quoted(agent.models.iter().map(|model| model.id.as_str()))
        );
    }
    // Inherited, not asked for: fall back to what the target workspace would
    // have chosen by itself rather than refusing a launch nobody specified.
    request.model_id = agent.default_model_id.clone();
    Ok(())
}

/// The mode, against the model the request SETTLED on — which is why this runs
/// after the model is resolved: an inherited model replaced by the target's
/// default brings the target's mode menu with it, and validating against the
/// model the caller arrived with would check the wrong list.
fn resolve_mode_against_agent(
    request: &mut CreateAgentSessionRequest,
    agent: &ResolvedLaunchAgentOption,
) -> anyhow::Result<()> {
    let Some(mode_id) = request.mode_id.clone() else {
        return Ok(());
    };
    let model = request
        .model_id
        .clone()
        .and_then(|model_id| find_model(agent, &model_id));
    // `modes: None` is an authoritative "this model has no mode control", not
    // an empty menu, so there is nothing here to check the selection against.
    let Some(offered) = model.and_then(|model| model.modes.as_ref()) else {
        return Ok(());
    };
    if offered.iter().any(|offered| *offered == mode_id) {
        return Ok(());
    }
    if request.mode_id_explicit {
        anyhow::bail!(
            "mode {mode_id:?} is not available for {} in workspace {}. Available there: {}.",
            request.agent_kind,
            request.workspace_id,
            join_quoted(offered.iter().map(String::as_str))
        );
    }
    // Inherited only. The curated unattended mode is what this harness is
    // vetted to run with when nobody is watching, and `None` there is an
    // authoritative "no vetted default" — so the mode is dropped and the
    // target picks its own at launch, rather than carrying over one the
    // target's model does not list.
    request.mode_id = agent.unattended_mode_id.clone();
    Ok(())
}

fn find_model<'a>(
    agent: &'a ResolvedLaunchAgentOption,
    model_id: &str,
) -> Option<&'a ResolvedLaunchModelOption> {
    agent
        .models
        .iter()
        .find(|model| model.id == model_id || model.aliases.iter().any(|alias| alias == model_id))
}

fn join_quoted<'a>(values: impl Iterator<Item = &'a str>) -> String {
    let joined = values
        .map(|value| format!("{value:?}"))
        .collect::<Vec<_>>()
        .join(", ");
    if joined.is_empty() {
        "nothing".to_string()
    } else {
        joined
    }
}

/// Create, own, start and prompt one new agent, unwinding on any failure.
pub(super) async fn create_agent_session(
    service: &SubagentService,
    ownership: &AgentOwnershipService,
    wake_service: &AgentWakeService,
    session_runtime: &SessionRuntime,
    caller: &SessionRecord,
    mut request: CreateAgentSessionRequest,
) -> anyhow::Result<CreatedAgentSession> {
    // Against the TARGET workspace's options, before a single durable row
    // exists: a harness or model that workspace cannot run would otherwise
    // fail at start, with a half-built session already inserted.
    resolve_launch_against_target_workspace(&mut request, |workspace_id| {
        session_runtime.resolved_workspace_launch_options(workspace_id)
    })?;
    let request = request;
    let child = session_runtime
        .create_durable_session(
            &request.workspace_id,
            &request.agent_kind,
            None,
            request.model_id.as_deref(),
            request.mode_id.as_deref(),
            None,
            Vec::new(),
            None,
            SessionMcpBindingPolicy::InheritWorkspace,
            request.child_subagents_enabled(),
            OriginContext::system_local_runtime(),
        )
        .map_err(|error| anyhow::anyhow!("{error:?}"))?;

    // The ownership row is the first thing that can legitimately refuse (the
    // fanout cap is enforced at this insert), so it runs before anything is
    // started and its failure only has the empty session to undo.
    let link = match link_new_agent(service, ownership, caller, &child.id, &request) {
        Ok(link) => link,
        Err(error) => {
            let _ = service.delete_session(&child.id);
            return Err(error);
        }
    };

    // Armed before the first prompt is dispatched: the wake fires on a
    // COMPLETED turn, and the turn this call is about to start is the first one
    // the caller wants to hear about.
    let wake_created = match arm_spawn_wake(service, wake_service, caller, &child.id, &request) {
        Ok(created) => created,
        Err(error) => {
            cleanup_child_session_after_failed_launch(service, &child.id, "schedule wake");
            return Err(error);
        }
    };

    let started = match session_runtime.start_persisted_session(&child).await {
        Ok(started) => started,
        Err(error) => {
            unwind_after_failed_dispatch(service, &link, &child.id, &request, "start agent");
            return Err(anyhow::anyhow!("{error:?}"));
        }
    };

    let (text, provenance) = first_prompt(caller, &link, &request);
    let prompt_outcome = match session_runtime
        .send_text_prompt_with_provenance(&started.id, text, provenance)
        .await
    {
        Ok(outcome) => outcome,
        Err(error) => {
            unwind_after_failed_dispatch(
                service,
                &link,
                &child.id,
                &request,
                "send initial prompt",
            );
            return Err(anyhow::anyhow!("{error:?}"));
        }
    };

    Ok(CreatedAgentSession {
        link,
        session: started,
        wake_created,
        prompt_outcome,
    })
}

fn link_new_agent(
    service: &SubagentService,
    ownership: &AgentOwnershipService,
    caller: &SessionRecord,
    child_session_id: &str,
    request: &CreateAgentSessionRequest,
) -> anyhow::Result<SessionLinkRecord> {
    // Two writers, because they are not the same write: a subagent link goes
    // through the atomic capped insert, an owned link through the plain one.
    let link = match request.ownership {
        AgentSessionOwnership::Subagent => service.link_child(
            &caller.id,
            child_session_id,
            request.label.clone(),
            None,
            None,
        )?,
        // The two workspace ids are handed over rather than assumed: a peer
        // can land in a workspace the caller spawned, and the link row records
        // which of the two it was.
        AgentSessionOwnership::OwnedAgent => ownership.link_owned_agent(
            &caller.id,
            &caller.workspace_id,
            child_session_id,
            &request.workspace_id,
            request.label.clone(),
        )?,
    };
    // Which is exactly why the relation is checked rather than passed: the two
    // paths each choose their own, and a spawn that wrote the other mode's
    // relation would be silently wrong in every reader downstream. Failing
    // here means the caller sees an error and the compensating delete runs,
    // instead of an agent existing under the wrong ownership.
    anyhow::ensure!(
        link.relation == request.ownership.relation(),
        "internal: a {:?} spawn wrote a '{}' ownership row",
        request.ownership,
        link.relation
    );
    Ok(link)
}

fn arm_spawn_wake(
    service: &SubagentService,
    wake_service: &AgentWakeService,
    caller: &SessionRecord,
    child_session_id: &str,
    request: &CreateAgentSessionRequest,
) -> anyhow::Result<bool> {
    if !request.wake_on_completion {
        return Ok(false);
    }
    match request.ownership {
        // The link-scoped schedule, keyed by the row `link_new_agent` just
        // wrote; it fires off the child's completion record.
        AgentSessionOwnership::Subagent => Ok(service
            .schedule_wake_for_target(&caller.id, None, Some(child_session_id))?
            .1),
        // A peer has no link the wake machinery reads, so it uses the
        // session-scoped table — the same row `schedule_agent_wake` would
        // write, which is what makes "interact with it afterward like any
        // peer" true of the wake too. The reason is `Reply`, because a spawn
        // IS a send awaiting an answer: the first prompt is the question, and
        // the peer's reply is the answer that makes the pointer redundant.
        // `ExplicitSchedule` would survive that reply and wake the owner a
        // second time with a contentless pointer to a message it already has —
        // and, because a re-arm keeps the STRONGER reason, would swallow any
        // `wakeOnReply` the owner armed on the same peer before that first
        // turn finished, disabling its consumption too.
        AgentSessionOwnership::OwnedAgent => Ok(wake_service
            .arm(&caller.id, child_session_id, AgentWakeReason::Reply)?
            .created),
    }
}

/// The first prompt, in the voice the relationship implies.
///
/// A subagent is being delegated to, so its prompt is the parent's task text
/// with link-scoped provenance — the shape the transcript has always rendered.
/// An owned agent is a peer being spoken to for the first time, so ADR §3.4
/// wraps it in the same envelope every later `send_agent_message` uses: it is
/// told who is talking and how to reply, and there is no second dialect for
/// "the first message".
fn first_prompt(
    caller: &SessionRecord,
    link: &SessionLinkRecord,
    request: &CreateAgentSessionRequest,
) -> (String, PromptProvenance) {
    match request.ownership {
        AgentSessionOwnership::Subagent => (
            request.prompt.clone(),
            parent_to_child_provenance(&caller.id, &link.id, request.label.clone()),
        ),
        AgentSessionOwnership::OwnedAgent => {
            agent_message(&AgentMessageSender::from_session(caller), &request.prompt).into_parts()
        }
    }
}

/// Take back everything a failed start or dispatch left behind.
///
/// Deleting the session is what actually clears a session-scoped wake (the
/// schedule rows go with the session). The link-scoped schedule is keyed by the
/// link rather than the child, so it is deleted explicitly first — belt and
/// braces for the case where the session delete is the thing that fails.
fn unwind_after_failed_dispatch(
    service: &SubagentService,
    link: &SessionLinkRecord,
    child_session_id: &str,
    request: &CreateAgentSessionRequest,
    context: &str,
) {
    if request.wake_on_completion && request.ownership == AgentSessionOwnership::Subagent {
        cleanup_wake_schedule_after_failed_dispatch(service, &link.id, context);
    }
    cleanup_child_session_after_failed_launch(service, child_session_id, context);
}

fn cleanup_child_session_after_failed_launch(
    service: &SubagentService,
    child_session_id: &str,
    context: &str,
) {
    if let Err(error) = service.delete_session(child_session_id) {
        tracing::warn!(
            child_session_id,
            context,
            error = ?error,
            "failed to clean up the new agent's session after launch failure"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::test_support;
    use crate::domains::agents::readiness::launch_options::{
        ResolvedLaunchAgentOption, ResolvedLaunchModelOption,
    };
    use crate::domains::sessions::admission::{NoControllerPolicy, SessionMutationAdmission};
    use crate::domains::sessions::agent_ops::peer_ops::consume_reply_wake;
    use crate::domains::sessions::agent_ops::tools::SpawnAgentArgs;
    use crate::domains::sessions::extensions::SessionTurnOutcome;
    use crate::domains::sessions::store::SessionStore;
    use crate::persistence::Db;
    use serde_json::json;
    use std::sync::Arc;

    fn session(id: &str) -> SessionRecord {
        SessionRecord {
            id: id.to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: None,
            agent_auth_contexts: None,
            requested_model_id: Some("requested-model".to_string()),
            current_model_id: Some("current-model".to_string()),
            requested_mode_id: Some("requested-mode".to_string()),
            current_mode_id: Some("current-mode".to_string()),
            title: Some("Schema audit".to_string()),
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: "2026-08-08T00:00:00Z".to_string(),
            updated_at: "2026-08-08T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            action_capabilities_json: None,
            origin: None,
        }
    }

    fn link(relation: SessionLinkRelation) -> SessionLinkRecord {
        use crate::domains::sessions::links::model::SessionLinkWorkspaceRelation;
        SessionLinkRecord {
            id: "link-1".to_string(),
            public_id: Some("subagent_abc".to_string()),
            relation,
            parent_session_id: "ses_caller".to_string(),
            child_session_id: "ses_child".to_string(),
            workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
            label: Some("API surface check".to_string()),
            created_by_turn_id: None,
            created_by_tool_call_id: None,
            created_at: "2026-08-08T00:00:00Z".to_string(),
            closed_at: None,
            promoted_at: None,
            closed_by_session_id: None,
            close_reason: None,
        }
    }

    fn subagent_args() -> CreateSubagentArgs {
        CreateSubagentArgs {
            prompt: "Audit the schema".to_string(),
            label: Some("  API surface check  ".to_string()),
            harness_id: None,
            initial_config: None,
            wake_on_completion: true,
        }
    }

    fn spawn_agent_args() -> SpawnAgentArgs {
        SpawnAgentArgs {
            prompt: "Audit the schema".to_string(),
            label: Some("  API surface check  ".to_string()),
            harness_id: None,
            initial_config: None,
            wake_on_completion: true,
            workspace_id: None,
        }
    }

    /// The equivalence the refactor rests on. Every field `spawn_subagent`
    /// used to compute inline is computed here now, so this is what would
    /// catch a passthrough quietly going missing in the move.
    #[test]
    fn a_subagent_request_inherits_the_parent_and_carries_the_wake_flag_through() {
        let request = CreateAgentSessionRequest::subagent(&session("ses_caller"), subagent_args())
            .expect("build request");

        assert_eq!(request.ownership, AgentSessionOwnership::Subagent);
        assert_eq!(request.workspace_id, "workspace-1");
        assert_eq!(request.agent_kind, "claude");
        assert_eq!(request.model_id.as_deref(), Some("current-model"));
        assert_eq!(request.mode_id.as_deref(), Some("current-mode"));
        assert_eq!(request.label.as_deref(), Some("API surface check"));
        assert_eq!(request.prompt, "Audit the schema");
        assert!(
            request.wake_on_completion,
            "wakeOnCompletion must survive the arg-to-request mapping, or a spawn that asked to \
             be woken silently is not"
        );
        // A subagent may not spawn: ruling 3's durable half.
        assert!(!request.child_subagents_enabled());
    }

    #[test]
    fn explicit_launch_choices_beat_inheritance_and_a_blank_label_is_dropped() {
        let args = CreateSubagentArgs {
            prompt: "Audit the schema".to_string(),
            label: Some("   ".to_string()),
            harness_id: Some("codex".to_string()),
            initial_config: Some(json!({ "modelId": "gpt-5", "modeId": "plan" })),
            wake_on_completion: false,
        };

        let request =
            CreateAgentSessionRequest::subagent(&session("ses_caller"), args).expect("build");

        assert_eq!(request.agent_kind, "codex");
        assert_eq!(request.model_id.as_deref(), Some("gpt-5"));
        assert_eq!(request.mode_id.as_deref(), Some("plan"));
        assert_eq!(request.label, None);
        assert!(!request.wake_on_completion);
    }

    #[test]
    fn a_parent_with_no_current_values_falls_back_to_what_it_requested() {
        let mut parent = session("ses_caller");
        parent.current_model_id = None;
        parent.current_mode_id = None;

        let request =
            CreateAgentSessionRequest::subagent(&parent, subagent_args()).expect("build request");

        assert_eq!(request.model_id.as_deref(), Some("requested-model"));
        assert_eq!(request.mode_id.as_deref(), Some("requested-mode"));
    }

    #[test]
    fn an_owned_agent_inherits_the_same_way_but_is_born_able_to_spawn() {
        let request =
            CreateAgentSessionRequest::owned_agent(&session("ses_caller"), spawn_agent_args())
                .expect("build request");

        assert_eq!(request.ownership, AgentSessionOwnership::OwnedAgent);
        assert_eq!(request.agent_kind, "claude");
        assert_eq!(request.model_id.as_deref(), Some("current-model"));
        assert_eq!(request.label.as_deref(), Some("API surface check"));
        assert!(request.wake_on_completion);
        // Never "unpromoted": it has the full surface from birth (ADR §3.4).
        assert!(request.child_subagents_enabled());
    }

    #[test]
    fn neither_spawn_accepts_an_empty_prompt() {
        for blank in ["", "   ", "\n\t"] {
            assert!(CreateAgentSessionRequest::subagent(
                &session("ses_caller"),
                CreateSubagentArgs {
                    prompt: blank.to_string(),
                    ..subagent_args()
                },
            )
            .is_err());
            assert!(CreateAgentSessionRequest::owned_agent(
                &session("ses_caller"),
                SpawnAgentArgs {
                    prompt: blank.to_string(),
                    ..spawn_agent_args()
                },
            )
            .is_err());
        }
    }

    #[test]
    fn spawn_agent_lands_the_peer_in_the_workspace_it_was_given() {
        let caller = session("ses_caller");

        let same = CreateAgentSessionRequest::owned_agent(
            &caller,
            SpawnAgentArgs {
                workspace_id: Some("  workspace-1  ".to_string()),
                ..spawn_agent_args()
            },
        )
        .expect("naming your own workspace is fine");
        assert_eq!(same.workspace_id, "workspace-1");
        assert!(!same.is_cross_workspace(&caller));

        // The other half of ADR §5 flow 4: `spawn_workspace` makes a workspace,
        // and this is the tool that puts an agent in it. Refusing here (as the
        // pre-`spawn_workspace` build did) would leave the new workspace with
        // no way to get an agent into it.
        let elsewhere = CreateAgentSessionRequest::owned_agent(
            &caller,
            SpawnAgentArgs {
                workspace_id: Some("workspace-2".to_string()),
                ..spawn_agent_args()
            },
        )
        .expect("another workspace is allowed");
        assert_eq!(elsewhere.workspace_id, "workspace-2");
        assert!(elsewhere.is_cross_workspace(&caller));

        // Omitted still means "here".
        let defaulted =
            CreateAgentSessionRequest::owned_agent(&caller, spawn_agent_args()).expect("build");
        assert_eq!(defaulted.workspace_id, "workspace-1");
    }

    #[test]
    fn a_subagent_is_pinned_to_the_callers_workspace_with_no_way_to_ask_otherwise() {
        // Ruling: subagents stay own-workspace only (ADR §5 flow 4). The tool
        // takes no workspace argument at all, so this pins the derivation.
        let request = CreateAgentSessionRequest::subagent(&session("ses_caller"), subagent_args())
            .expect("build request");

        assert_eq!(request.workspace_id, "workspace-1");
        assert!(!request.is_cross_workspace(&session("ses_caller")));
    }

    // --- launch validation against the TARGET workspace (ADR §5 flow 4) ---

    fn model_option(id: &str) -> ResolvedLaunchModelOption {
        ResolvedLaunchModelOption {
            id: id.to_string(),
            display_name: id.to_string(),
            aliases: Vec::new(),
            is_default: false,
            default_opt_in: None,
            description: None,
            provider: None,
            status: None,
            effort: None,
            live_effort_candidates: Vec::new(),
            fast_mode: false,
            modes: None,
        }
    }

    /// A model that declares a mode control, which is the only case a mode can
    /// be checked against. `modes: None` on `model_option` is the other case,
    /// and it is a real one — see the pass-through test below.
    fn model_option_offering(id: &str, modes: &[&str]) -> ResolvedLaunchModelOption {
        ResolvedLaunchModelOption {
            modes: Some(modes.iter().map(|mode| (*mode).to_string()).collect()),
            ..model_option(id)
        }
    }

    fn agent_option(kind: &str, model_ids: &[&str]) -> ResolvedLaunchAgentOption {
        ResolvedLaunchAgentOption {
            kind: kind.to_string(),
            display_name: kind.to_string(),
            default_model_id: model_ids.first().map(|id| (*id).to_string()),
            unattended_mode_id: None,
            models: model_ids.iter().map(|id| model_option(id)).collect(),
        }
    }

    fn agent_option_offering(
        kind: &str,
        model_id: &str,
        modes: &[&str],
        unattended_mode_id: Option<&str>,
    ) -> ResolvedLaunchAgentOption {
        ResolvedLaunchAgentOption {
            unattended_mode_id: unattended_mode_id.map(ToString::to_string),
            models: vec![model_option_offering(model_id, modes)],
            ..agent_option(kind, &[model_id])
        }
    }

    /// Records which workspace id the launch resolution asked the catalog
    /// about, and answers with deliberately DISJOINT menus per workspace, so
    /// composing the wrong one is visible in the outcome and not only in the
    /// spy. Same shape as `config_ops`' spy, for the same guarantee.
    struct CatalogSpy {
        asked: std::cell::RefCell<Vec<String>>,
    }

    impl CatalogSpy {
        fn new() -> Self {
            Self {
                asked: std::cell::RefCell::new(Vec::new()),
            }
        }

        fn resolver(
            &self,
        ) -> impl FnOnce(&str) -> anyhow::Result<ResolvedWorkspaceLaunchOptions> + '_ {
            move |workspace_id: &str| {
                self.asked.borrow_mut().push(workspace_id.to_string());
                Ok(ResolvedWorkspaceLaunchOptions {
                    agents: match workspace_id {
                        "workspace-1" => vec![agent_option_offering(
                            "claude",
                            "caller-only-model",
                            &["caller-only-mode"],
                            Some("caller-only-mode"),
                        )],
                        "workspace-2" => vec![
                            agent_option_offering(
                                "claude",
                                "target-only-model",
                                &["target-only-mode"],
                                Some("target-only-mode"),
                            ),
                            // No mode control at all, which is the arm that
                            // has nothing to check a mode against.
                            agent_option("codex", &["target-codex-model"]),
                        ],
                        _ => Vec::new(),
                    },
                })
            }
        }
    }

    fn cross_workspace_request() -> CreateAgentSessionRequest {
        CreateAgentSessionRequest::owned_agent(
            &session("ses_caller"),
            SpawnAgentArgs {
                workspace_id: Some("workspace-2".to_string()),
                ..spawn_agent_args()
            },
        )
        .expect("build request")
    }

    #[test]
    fn the_launch_selection_is_resolved_against_the_target_workspace_not_the_caller() {
        let spy = CatalogSpy::new();
        let mut request = cross_workspace_request();
        // Inherited from the caller, whose workspace is the only place that
        // model exists.
        assert_eq!(request.model_id.as_deref(), Some("current-model"));
        assert!(!request.model_id_explicit);

        resolve_launch_against_target_workspace(&mut request, spy.resolver())
            .expect("an inherited model the target lacks falls back, it does not fail");

        // The whole point: workspace-2, never workspace-1.
        assert_eq!(spy.asked.borrow().as_slice(), ["workspace-2"]);
        // And it landed on the TARGET's default, not the caller's model and not
        // the caller workspace's default.
        assert_eq!(request.model_id.as_deref(), Some("target-only-model"));
        assert_ne!(request.model_id.as_deref(), Some("caller-only-model"));
        // The mode is the third selection and follows the same rule: inherited,
        // not offered there, so it becomes the target harness's curated default
        // rather than travelling across as-is.
        assert_eq!(request.mode_id.as_deref(), Some("target-only-mode"));
    }

    #[test]
    fn a_mode_only_the_callers_workspace_offers_is_refused_when_the_caller_named_it() {
        let spy = CatalogSpy::new();
        let mut request = CreateAgentSessionRequest::owned_agent(
            &session("ses_caller"),
            SpawnAgentArgs {
                workspace_id: Some("workspace-2".to_string()),
                initial_config: Some(
                    json!({ "modelId": "target-only-model", "modeId": "caller-only-mode" }),
                ),
                ..spawn_agent_args()
            },
        )
        .expect("build request");
        assert!(request.mode_id_explicit);

        let error = resolve_launch_against_target_workspace(&mut request, spy.resolver())
            .err()
            .expect("a named mode outside the target's menu is refused");

        let message = error.to_string();
        assert!(message.contains("caller-only-mode"), "{message}");
        // The refusal names what IS offered there, so the agent can retry.
        assert!(message.contains("target-only-mode"), "{message}");
    }

    #[test]
    fn a_mode_the_target_workspace_offers_is_kept_verbatim() {
        let spy = CatalogSpy::new();
        let mut request = CreateAgentSessionRequest::owned_agent(
            &session("ses_caller"),
            SpawnAgentArgs {
                workspace_id: Some("workspace-2".to_string()),
                initial_config: Some(
                    json!({ "modelId": "target-only-model", "modeId": "target-only-mode" }),
                ),
                ..spawn_agent_args()
            },
        )
        .expect("build request");

        resolve_launch_against_target_workspace(&mut request, spy.resolver()).expect("accepted");

        assert_eq!(request.mode_id.as_deref(), Some("target-only-mode"));
    }

    #[test]
    fn a_model_with_no_mode_control_has_nothing_to_check_the_mode_against() {
        // `modes: None` is "this model declares no mode control", not "no modes
        // are allowed". Refusing there would name an empty list, so the caller's
        // mode is passed through — the same asymmetry the empty catalog has.
        let spy = CatalogSpy::new();
        let mut request = CreateAgentSessionRequest::owned_agent(
            &session("ses_caller"),
            SpawnAgentArgs {
                harness_id: Some("codex".to_string()),
                workspace_id: Some("workspace-2".to_string()),
                initial_config: Some(json!({ "modeId": "anything-at-all" })),
                ..spawn_agent_args()
            },
        )
        .expect("build request");

        resolve_launch_against_target_workspace(&mut request, spy.resolver())
            .expect("a model with no mode control decides nothing about the mode");

        assert_eq!(request.mode_id.as_deref(), Some("anything-at-all"));
    }

    #[test]
    fn a_model_only_the_callers_workspace_offers_is_refused_when_the_caller_named_it() {
        let spy = CatalogSpy::new();
        let mut request = CreateAgentSessionRequest::owned_agent(
            &session("ses_caller"),
            SpawnAgentArgs {
                workspace_id: Some("workspace-2".to_string()),
                initial_config: Some(json!({ "modelId": "caller-only-model" })),
                ..spawn_agent_args()
            },
        )
        .expect("build request");
        assert!(request.model_id_explicit);

        let error = resolve_launch_against_target_workspace(&mut request, spy.resolver())
            .err()
            .expect("a named model outside the target's catalog is refused");

        assert!(error.to_string().contains("caller-only-model"));
        // Resolving against the caller's catalog would have accepted it.
        assert_eq!(spy.asked.borrow().as_slice(), ["workspace-2"]);
    }

    #[test]
    fn a_model_the_target_workspace_offers_is_kept_verbatim() {
        let spy = CatalogSpy::new();
        let mut request = CreateAgentSessionRequest::owned_agent(
            &session("ses_caller"),
            SpawnAgentArgs {
                workspace_id: Some("workspace-2".to_string()),
                initial_config: Some(json!({ "modelId": "target-only-model" })),
                ..spawn_agent_args()
            },
        )
        .expect("build request");

        resolve_launch_against_target_workspace(&mut request, spy.resolver()).expect("accepted");

        assert_eq!(request.model_id.as_deref(), Some("target-only-model"));
    }

    #[test]
    fn a_harness_the_target_cannot_launch_is_refused_and_names_what_it_can() {
        let spy = CatalogSpy::new();
        let mut request = CreateAgentSessionRequest::owned_agent(
            &session("ses_caller"),
            SpawnAgentArgs {
                harness_id: Some("grok".to_string()),
                workspace_id: Some("workspace-2".to_string()),
                ..spawn_agent_args()
            },
        )
        .expect("build request");

        let error = resolve_launch_against_target_workspace(&mut request, spy.resolver())
            .err()
            .expect("an unlaunchable harness is refused");

        let message = error.to_string();
        assert!(message.contains("grok"));
        assert!(message.contains("claude"));
        assert!(message.contains("codex"));
    }

    #[test]
    fn a_workspace_whose_catalog_resolves_to_nothing_is_passed_through() {
        // No launchable agents means readiness could not be established here,
        // not that the request is wrong. Refusing would name nothing.
        let spy = CatalogSpy::new();
        let mut request = CreateAgentSessionRequest::owned_agent(
            &session("ses_caller"),
            SpawnAgentArgs {
                workspace_id: Some("workspace-unknown".to_string()),
                ..spawn_agent_args()
            },
        )
        .expect("build request");

        resolve_launch_against_target_workspace(&mut request, spy.resolver())
            .expect("an empty catalog decides nothing");

        assert_eq!(request.agent_kind, "claude");
        assert_eq!(request.model_id.as_deref(), Some("current-model"));
    }

    #[test]
    fn the_real_resolver_is_handed_the_target_workspace_too() {
        // The spy tests above pin the ROUTINE. This pins the one call site that
        // feeds it: `create_agent_session` has both the caller and the request
        // in scope, and passing `caller.workspace_id` would compile, pass every
        // test above, and quietly compose a cross-workspace spawn against the
        // wrong catalog.
        let source = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("src/domains/sessions/agent_ops/spawn_ops.rs"),
        )
        .expect("read spawn_ops.rs");
        let body = source
            .split_once("pub(super) async fn create_agent_session(")
            .expect("create_agent_session exists")
            .1;
        let body = body
            .split_once("\npub ")
            .map(|(head, _)| head)
            .unwrap_or(body);
        let call = body
            .split_once("resolve_launch_against_target_workspace(")
            .expect("create_agent_session must resolve the launch selection first")
            .1;
        let call = &call[..call.find("})?;").expect("closure ends") + 4];
        assert!(
            call.contains("session_runtime.resolved_workspace_launch_options(workspace_id)"),
            "create_agent_session must resolve against the workspace the routine names — the \
             TARGET's"
        );
        assert!(
            !call.contains("caller."),
            "create_agent_session must not resolve the launch selection against the CALLER's \
             workspace: the target authorizes its own harnesses and models"
        );
    }

    #[test]
    fn the_ownership_mode_picks_the_relation_the_link_row_gets() {
        // An owned agent's row must NOT say `subagent`: everything downstream —
        // the close cascade, the fanout subselect, the promote refusal — reads
        // the relation and nothing else. `link_new_agent` checks the row it
        // wrote against this, so a spawn that took the wrong writer fails
        // rather than producing a mislabelled agent.
        assert_eq!(
            AgentSessionOwnership::Subagent.relation(),
            SessionLinkRelation::Subagent
        );
        assert_eq!(
            AgentSessionOwnership::OwnedAgent.relation(),
            SessionLinkRelation::OwnedAgent
        );
    }

    /// The wake half of the spawn, over real stores.
    ///
    /// Both writers this function chooses between are store-backed, so the
    /// choice is provable without a runtime: arm through the production
    /// `arm_spawn_wake` and read the rows back. `ses_owner` spawns, `ses_peer`
    /// is the agent it spawns.
    struct WakeFixture {
        subagents: SubagentService,
        wakes: AgentWakeService,
        sessions: SessionStore,
        owner: SessionRecord,
    }

    fn wake_fixture() -> WakeFixture {
        let db = Db::open_in_memory().expect("open db");
        test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace-1");
        let fixture = test_support::subagent_service_fixture(&db);
        let owner = session("ses_owner");
        fixture.sessions.insert(&owner).expect("insert owner");
        fixture
            .sessions
            .insert(&session("ses_peer"))
            .expect("insert peer");
        let wakes = AgentWakeService::new(
            fixture.sessions.clone(),
            Arc::new(SessionMutationAdmission::new(Arc::new(NoControllerPolicy))),
        );
        WakeFixture {
            subagents: fixture.service,
            wakes,
            sessions: fixture.sessions,
            owner,
        }
    }

    fn peer_request(wake_on_completion: bool) -> CreateAgentSessionRequest {
        CreateAgentSessionRequest::owned_agent(
            &session("ses_owner"),
            SpawnAgentArgs {
                wake_on_completion,
                ..spawn_agent_args()
            },
        )
        .expect("build request")
    }

    #[tokio::test]
    async fn the_peers_reply_consumes_the_wake_its_spawn_armed() {
        // The arg description promises exactly this: "its reply already wakes
        // you with the full message; this is the safety net for one that
        // answers nobody". Only a REPLY arm behaves that way — an explicit
        // schedule survives the reply and fires a second, contentless pointer
        // at the same turn's end, so the owner burns a turn on a pointer to a
        // message it already has.
        let fixture = wake_fixture();

        assert!(arm_spawn_wake(
            &fixture.subagents,
            &fixture.wakes,
            &fixture.owner,
            "ses_peer",
            &peer_request(true),
        )
        .expect("arm the spawn wake"));

        let armed = fixture
            .sessions
            .list_agent_wakes_for_target("ses_peer")
            .expect("read the armed row");
        assert_eq!(armed.len(), 1);
        assert_eq!(armed[0].watcher_session_id, "ses_owner");
        assert!(
            armed[0].armed_for_reply,
            "a spawn wake must be consumable by the peer's reply"
        );

        // The peer answers its owner: the schedule comes off...
        assert!(consume_reply_wake(&fixture.wakes, "ses_peer", "ses_owner"));
        // ...so the turn that carried the reply wakes nobody, and no pointer
        // is queued behind the message the owner already received.
        assert!(fixture
            .wakes
            .consume_for_finished_turn("ses_peer", SessionTurnOutcome::Completed)
            .await
            .expect("the peer's first turn finishes")
            .is_empty());
        assert!(fixture
            .sessions
            .list_pending_prompts("ses_owner")
            .expect("owner's pending prompts")
            .is_empty());
    }

    #[tokio::test]
    async fn a_peer_that_answers_nobody_still_wakes_its_owner_at_turn_finish() {
        // The other half of the same contract: the safety net has to actually
        // catch. Nothing replied, so the schedule is still armed when the turn
        // ends and the owner gets its pointer.
        let fixture = wake_fixture();
        arm_spawn_wake(
            &fixture.subagents,
            &fixture.wakes,
            &fixture.owner,
            "ses_peer",
            &peer_request(true),
        )
        .expect("arm the spawn wake");

        let fired = fixture
            .wakes
            .consume_for_finished_turn("ses_peer", SessionTurnOutcome::Completed)
            .await
            .expect("the peer's first turn finishes");

        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].consumed.watcher_session_id, "ses_owner");
    }

    #[tokio::test]
    async fn a_spawn_that_asked_for_no_wake_arms_nothing() {
        // `wakeOnCompletion: false` must leave the table empty — otherwise the
        // owner is woken about an agent it said it did not need to hear from.
        let fixture = wake_fixture();

        assert!(!arm_spawn_wake(
            &fixture.subagents,
            &fixture.wakes,
            &fixture.owner,
            "ses_peer",
            &peer_request(false),
        )
        .expect("no wake asked for"));

        assert!(fixture
            .sessions
            .list_agent_wakes_for_target("ses_peer")
            .expect("read schedules")
            .is_empty());
    }

    #[test]
    fn a_subagent_spawn_takes_the_link_scoped_wake_and_writes_no_session_row() {
        // The other side of the mode split. A subagent's wake hangs off the
        // link completion row, so the session-scoped table must stay empty —
        // if both were written the parent would be woken twice, and if the
        // peer branch leaked into this one the wake would fire off a
        // completion record that never arrives.
        let fixture = wake_fixture();
        fixture
            .sessions
            .insert(&session("ses_child"))
            .expect("insert child");
        fixture
            .subagents
            .link_child("ses_owner", "ses_child", None, None, None)
            .expect("link the subagent");

        let mut request = peer_request(true);
        request.ownership = AgentSessionOwnership::Subagent;

        assert!(arm_spawn_wake(
            &fixture.subagents,
            &fixture.wakes,
            &fixture.owner,
            "ses_child",
            &request,
        )
        .expect("arm the subagent wake"));

        assert!(
            fixture
                .sessions
                .list_agent_wakes_for_target("ses_child")
                .expect("read schedules")
                .is_empty(),
            "a subagent's wake is link-scoped and must not write a session-scoped row"
        );
    }

    #[test]
    fn a_subagents_first_prompt_is_the_authored_text_and_a_peers_is_enveloped() {
        let caller = session("ses_caller");
        let mut request =
            CreateAgentSessionRequest::subagent(&caller, subagent_args()).expect("build");

        let (text, provenance) =
            first_prompt(&caller, &link(SessionLinkRelation::Subagent), &request);
        assert_eq!(text, "Audit the schema");
        assert_eq!(
            provenance,
            PromptProvenance::AgentSession {
                source_session_id: "ses_caller".to_string(),
                session_link_id: Some("link-1".to_string()),
                label: Some("API surface check".to_string()),
            }
        );

        request.ownership = AgentSessionOwnership::OwnedAgent;
        let (text, provenance) =
            first_prompt(&caller, &link(SessionLinkRelation::OwnedAgent), &request);
        // The peer is told who is talking and how to answer, and the body is
        // verbatim inside it — the same envelope `send_agent_message` builds.
        assert!(text.starts_with("Message from agent \"Schema audit\" (session ses_caller):"));
        assert!(text.contains("Audit the schema"));
        assert!(text.ends_with("To reply, use send_agent_message with sessionId \"ses_caller\"."));
        assert_eq!(
            provenance,
            PromptProvenance::AgentSession {
                source_session_id: "ses_caller".to_string(),
                // Unlinked, like every other peer message: the ownership row
                // exists, but the message does not claim it.
                session_link_id: None,
                label: Some("Schema audit".to_string()),
            }
        );
    }
}
