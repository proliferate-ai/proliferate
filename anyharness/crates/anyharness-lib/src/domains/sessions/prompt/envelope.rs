//! The single owner of agent-facing prompt copy: agent messages and wake
//! pointers.
//!
//! Two laws live here, and they are the reason this is one module instead of
//! format strings scattered across the call sites:
//!
//! - Text and provenance are produced as one value. A caller cannot take the
//!   envelope text without the metadata that describes it, so the transcript's
//!   rendered shape can never drift from what the harness actually received.
//! - One canonical text. What is sent is exactly what is stored — there is no
//!   "clean body in the row, envelope on the wire" split.
//!
//! Message vs pointer (the ADR's rule): a message carries the authored body
//! verbatim because someone deliberately wrote it; a wake is only ever a
//! pointer — label, id, outcome, next tool — never turn output.

use super::provenance::PromptProvenance;
use super::PromptPayload;
use crate::domains::sessions::extensions::SessionTurnOutcome;
use crate::domains::sessions::model::SessionRecord;

/// An agent-facing prompt and the provenance that describes it, as one value.
#[derive(Debug, Clone)]
pub(crate) struct EnvelopedPrompt {
    text: String,
    provenance: PromptProvenance,
}

impl EnvelopedPrompt {
    /// Inspection seams for the copy tests. Production code always takes both
    /// halves at once, which is the point of the type.
    #[cfg(test)]
    pub(crate) fn text(&self) -> &str {
        &self.text
    }

    #[cfg(test)]
    pub(crate) fn provenance(&self) -> &PromptProvenance {
        &self.provenance
    }

    /// For dispatch paths that take text and provenance as separate arguments
    /// (`send_text_prompt_with_provenance`). Splitting is allowed; building
    /// either half independently is not.
    pub(crate) fn into_parts(self) -> (String, PromptProvenance) {
        (self.text, self.provenance)
    }

    pub(crate) fn into_payload(self) -> PromptPayload {
        PromptPayload::text(self.text).with_provenance(self.provenance)
    }
}

/// Who an agent message is from, resolved once so the rendered label and the
/// stored label are the same string.
#[derive(Debug, Clone)]
pub(crate) struct AgentMessageSender {
    pub session_id: String,
    pub label: String,
}

impl AgentMessageSender {
    pub(crate) fn from_session(session: &SessionRecord) -> Self {
        let label = session
            .title
            .as_deref()
            .map(str::trim)
            .filter(|title| !title.is_empty())
            .unwrap_or(session.agent_kind.as_str())
            .to_string();
        Self {
            session_id: session.id.clone(),
            label,
        }
    }
}

/// A peer-to-peer agent message: who is talking, the authored body verbatim,
/// and how to reply.
///
/// The envelope is what amends the metadata-only provenance rule for peer
/// messaging: unlike a parent's delegation prompt, the receiver has to know
/// which of its peers is speaking and which handle answers it.
pub(crate) fn agent_message(sender: &AgentMessageSender, body: &str) -> EnvelopedPrompt {
    let text = format!(
        "Message from agent \"{label}\" (session {session_id}):\n\n{body}\n\nTo reply, use send_agent_message with sessionId \"{session_id}\".",
        label = sender.label,
        session_id = sender.session_id,
    );
    EnvelopedPrompt {
        text,
        provenance: PromptProvenance::AgentSession {
            source_session_id: sender.session_id.clone(),
            // Peer messaging is unlinked by construction: reach is runtime-wide
            // and carries no ownership claim over the target.
            session_link_id: None,
            label: Some(sender.label.clone()),
        },
    }
}

/// What a subagent completion wakes its parent with.
#[derive(Debug, Clone, Copy)]
pub(crate) struct SubagentWakePointer<'a> {
    pub session_link_id: &'a str,
    pub completion_id: &'a str,
    pub subagent_id: Option<&'a str>,
    pub label: Option<&'a str>,
    pub outcome: SessionTurnOutcome,
}

/// The subagent wake pointer. Constant shape, no turn output: reads are
/// budgeted for exactly that, and a wake must stay the same size no matter
/// what the child did.
pub(crate) fn subagent_wake(pointer: SubagentWakePointer<'_>) -> EnvelopedPrompt {
    let label = pointer.label.unwrap_or("subagent");
    let subagent_id = pointer.subagent_id.unwrap_or("unknown");
    let text = format!(
        "Subagent \"{label}\" completed a turn.\n\nsubagentId: {subagent_id}\nOutcome: {}\n\nUse read_subagent_latest_turns or search_subagent_transcript with this subagentId before relying on the result.",
        pointer.outcome.as_str()
    );
    EnvelopedPrompt {
        text,
        provenance: PromptProvenance::SubagentWake {
            session_link_id: pointer.session_link_id.to_string(),
            completion_id: pointer.completion_id.to_string(),
            label: pointer.label.map(ToString::to_string),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};

    fn session(id: &str, title: Option<&str>) -> SessionRecord {
        SessionRecord {
            id: id.to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: None,
            agent_auth_contexts: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: title.map(ToString::to_string),
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

    #[test]
    fn agent_message_names_the_sender_quotes_the_body_verbatim_and_gives_the_reply_handle() {
        let sender = AgentMessageSender::from_session(&session("ses_abc", Some("Deploy Checker")));

        let enveloped = agent_message(&sender, "  Ship it?\n\nsecond line  ");

        assert_eq!(
            enveloped.text(),
            "Message from agent \"Deploy Checker\" (session ses_abc):\n\n  Ship it?\n\nsecond line  \n\nTo reply, use send_agent_message with sessionId \"ses_abc\"."
        );
    }

    #[test]
    fn agent_message_provenance_carries_the_same_label_the_text_rendered() {
        let sender = AgentMessageSender::from_session(&session("ses_abc", Some(" Deploy Checker ")));

        let enveloped = agent_message(&sender, "body");
        let rendered_label = "Deploy Checker";

        assert!(enveloped
            .text()
            .starts_with(&format!("Message from agent \"{rendered_label}\"")));
        assert_eq!(
            enveloped.provenance(),
            &PromptProvenance::AgentSession {
                source_session_id: "ses_abc".to_string(),
                session_link_id: None,
                label: Some(rendered_label.to_string()),
            }
        );
    }

    #[test]
    fn an_untitled_sender_falls_back_to_its_harness_name() {
        for title in [None, Some(""), Some("   ")] {
            let sender = AgentMessageSender::from_session(&session("ses_abc", title));

            assert_eq!(sender.label, "claude");
            assert!(agent_message(&sender, "body")
                .text()
                .starts_with("Message from agent \"claude\" (session ses_abc):"));
        }
    }

    #[test]
    fn the_payload_stores_exactly_the_text_that_is_sent() {
        let sender = AgentMessageSender::from_session(&session("ses_abc", Some("Deploy Checker")));
        let enveloped = agent_message(&sender, "body");
        let sent_text = enveloped.text().to_string();

        let payload = enveloped.into_payload();

        assert_eq!(payload.text_summary, sent_text);
        assert_eq!(
            payload
                .provenance_json()
                .expect("provenance json")
                .expect("provenance present"),
            r#"{"kind":"agent_session","sourceSessionId":"ses_abc","label":"Deploy Checker"}"#
        );
    }

    #[test]
    fn the_subagent_wake_pointer_copy_is_unchanged() {
        let enveloped = subagent_wake(SubagentWakePointer {
            session_link_id: "link-1",
            completion_id: "completion-1",
            subagent_id: Some("subagent_abc123"),
            label: Some("API Surface Check"),
            outcome: SessionTurnOutcome::Completed,
        });

        assert_eq!(
            enveloped.text(),
            "Subagent \"API Surface Check\" completed a turn.\n\nsubagentId: subagent_abc123\nOutcome: completed\n\nUse read_subagent_latest_turns or search_subagent_transcript with this subagentId before relying on the result."
        );
        assert_eq!(
            enveloped.provenance(),
            &PromptProvenance::SubagentWake {
                session_link_id: "link-1".to_string(),
                completion_id: "completion-1".to_string(),
                label: Some("API Surface Check".to_string()),
            }
        );
    }

    #[test]
    fn the_subagent_wake_pointer_falls_back_the_way_it_always_has() {
        let enveloped = subagent_wake(SubagentWakePointer {
            session_link_id: "link-1",
            completion_id: "completion-1",
            subagent_id: None,
            label: None,
            outcome: SessionTurnOutcome::Failed,
        });

        assert_eq!(
            enveloped.text(),
            "Subagent \"subagent\" completed a turn.\n\nsubagentId: unknown\nOutcome: failed\n\nUse read_subagent_latest_turns or search_subagent_transcript with this subagentId before relying on the result."
        );
    }
}
