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
//! | wake | link-scoped, on the child's next completion | session-scoped, the same table `schedule_agent_wake` writes |
//!
//! Everything else — inheritance of the caller's harness/model/mode, the
//! compensating cleanup, the shape of the result — is shared, which is the
//! point: the two spawn shapes cannot drift apart on the parts that are not
//! about ownership.

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
    pub workspace_id: String,
    pub agent_kind: String,
    pub model_id: Option<String>,
    pub mode_id: Option<String>,
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
    pub fn owned_agent(caller: &SessionRecord, args: SpawnAgentArgs) -> anyhow::Result<Self> {
        if let Some(requested) = args
            .workspace_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            // The argument is accepted rather than ignored on purpose: silently
            // dropping it would spawn the agent somewhere the caller did not
            // ask for. Other workspaces become reachable with `spawn_workspace`
            // (ADR §6 step 7); until then this tool creates the session in the
            // workspace whose write lease the route already holds.
            if requested != caller.workspace_id {
                anyhow::bail!(
                    "spawn_agent creates the agent in your own workspace ({}), and cannot yet \
                     target {requested}. Send a message to an agent already in that workspace, \
                     or ask a person to open one.",
                    caller.workspace_id
                );
            }
        }
        Self::inherit_from(
            caller,
            AgentSessionOwnership::OwnedAgent,
            args.prompt,
            args.label,
            args.harness_id,
            args.initial_config.as_ref(),
            args.wake_on_completion,
        )
    }

    fn inherit_from(
        caller: &SessionRecord,
        ownership: AgentSessionOwnership,
        prompt: String,
        label: Option<String>,
        harness_id: Option<String>,
        initial_config: Option<&serde_json::Value>,
        wake_on_completion: bool,
    ) -> anyhow::Result<Self> {
        if prompt.trim().is_empty() {
            anyhow::bail!("prompt is required");
        }
        Ok(Self {
            ownership,
            workspace_id: caller.workspace_id.clone(),
            agent_kind: harness_id.unwrap_or_else(|| caller.agent_kind.clone()),
            model_id: initial_config_string(initial_config, &["modelId", "model"])
                .or_else(|| caller.current_model_id.clone())
                .or_else(|| caller.requested_model_id.clone()),
            mode_id: initial_config_string(initial_config, &["modeId", "mode"])
                .or_else(|| caller.current_mode_id.clone())
                .or_else(|| caller.requested_mode_id.clone()),
            label: label
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            prompt,
            wake_on_completion,
        })
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

/// Create, own, start and prompt one new agent, unwinding on any failure.
pub(super) async fn create_agent_session(
    service: &SubagentService,
    ownership: &AgentOwnershipService,
    wake_service: &AgentWakeService,
    session_runtime: &SessionRuntime,
    caller: &SessionRecord,
    request: CreateAgentSessionRequest,
) -> anyhow::Result<CreatedAgentSession> {
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
        AgentSessionOwnership::OwnedAgent => {
            ownership.link_owned_agent(&caller.id, child_session_id, request.label.clone())?
        }
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
        // peer" true of the wake too. `ExplicitSchedule`, not `Reply`: nothing
        // has been replied to, so no later message may consume it.
        AgentSessionOwnership::OwnedAgent => Ok(wake_service
            .arm(
                &caller.id,
                child_session_id,
                AgentWakeReason::ExplicitSchedule,
            )?
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
    use crate::domains::sessions::agent_ops::tools::SpawnAgentArgs;
    use serde_json::json;

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
    fn spawn_agent_takes_the_callers_own_workspace_and_refuses_another() {
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

        // Refused rather than ignored: silently spawning in the caller's
        // workspace would put the agent somewhere it was not asked for, and the
        // route's write lease covers only this workspace anyway.
        let error = CreateAgentSessionRequest::owned_agent(
            &caller,
            SpawnAgentArgs {
                workspace_id: Some("workspace-2".to_string()),
                ..spawn_agent_args()
            },
        )
        .err()
        .expect("another workspace is refused");
        assert!(error.to_string().contains("workspace-2"));
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
