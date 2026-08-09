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
    if offered.contains(&mode_id) {
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
#[path = "spawn_ops_tests.rs"]
mod tests;
