//! Parallel-node fan-out (ruling F5): the actor's launch path for a node whose
//! definition carries N authored leg prompts. One rendered envelope per leg
//! (same doc set and inputs, distinct prompt), N minted sessions, N ledger rows
//! keyed by `leg_index` in the transaction that stamps the representative (leg
//! 0). Split out of `actor.rs` so that seam stays under its size ratchet; the
//! one-leg launch path stays inline in the actor, byte-identical to before.

use std::path::Path;

use crate::domains::sessions::model::SessionRecord;
use crate::domains::sessions::runtime::{InternalSessionCreateInput, TextPromptDispatchError};
use crate::domains::workflows::definition::{ResolveMode, WorkflowDefinition};
use crate::domains::workflows::model::{RenderedEnvelope, WorkflowNodeKind, WorkflowRunNodeRecord};
use crate::domains::workflows::render::{render_envelope, run_context_dir_relative, RenderInputs};
use crate::origin::OriginContext;

use super::actor::{WorkflowActorDeps, DEFAULT_WORKFLOW_AGENT_KIND};

/// Launch config precedence, shared with the single-leg path: the node row's
/// own pick wins (adhoc, and adhoc-redo inheritance per Ruling K.1); a
/// defined/replacement row resolves through the frozen definition by its
/// `definition_node_id`; otherwise the boring app default.
pub(super) fn launch_model(
    node: &WorkflowRunNodeRecord,
    definition: &WorkflowDefinition,
) -> (String, Option<String>, Option<String>) {
    let model = node.model.clone().or_else(|| {
        node.definition_node_id
            .as_deref()
            .and_then(|id| definition.nodes.iter().find(|node| node.id == id))
            .and_then(|node| node.model.clone())
    });
    match model {
        Some(model) => (model.agent_kind, model.model_id, model.mode_id),
        None => (DEFAULT_WORKFLOW_AGENT_KIND.to_string(), None, None),
    }
}

/// The authored leg prompts of a defined parallel node, in leg order. Leg 0 is
/// the node prompt (validation pins `legs[0].prompt == prompt`), so this is the
/// prompt-to-leg selection the invariant test exercises.
pub(super) fn leg_prompts(node: &WorkflowRunNodeRecord, definition: &WorkflowDefinition) -> Vec<String> {
    node.definition_node_id
        .as_deref()
        .filter(|_| node.kind == WorkflowNodeKind::Defined)
        .and_then(|id| definition.nodes.iter().find(|candidate| candidate.id == id))
        .map(|candidate| {
            candidate
                .leg_prompts()
                .into_iter()
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| vec![node.prompt.clone()])
}

/// Render leg `prompt`'s envelope against the shared doc set and inputs. Same
/// path as the single-leg render; only the prompt differs per leg.
fn render_leg(
    deps: &WorkflowActorDeps,
    run_id: &str,
    node: &WorkflowRunNodeRecord,
    workspace_path: &str,
    arguments: &serde_json::Map<String, serde_json::Value>,
    prompt: &str,
) -> anyhow::Result<RenderedEnvelope> {
    let docs = deps.store.list_docs(run_id)?;
    let context_dir = Path::new(workspace_path).join(run_context_dir_relative(run_id));
    render_envelope(&RenderInputs {
        node_type: node.node_type,
        prompt,
        // Ruling E: a defined node's leg prompts were validated before the
        // snapshot froze and render strict.
        mode: if node.kind == WorkflowNodeKind::Defined {
            ResolveMode::Strict
        } else {
            ResolveMode::Lenient
        },
        arguments,
        docs: &docs,
        context_dir: &context_dir,
    })
    .map_err(|error| anyhow::anyhow!("leg envelope render failed: {error}"))
}

/// Fan a node out to one session per authored leg prompt (ruling F5). Mints N
/// sessions and links their workflow columns, then in one transaction stamps
/// the representative session (leg 0) and inserts N ledger rows keyed by
/// leg_index, then starts and dispatches each leg's envelope. Any failure
/// compensates every session already minted so no half-born leg lingers, and
/// bubbles up so the actor feeds `NodeLaunchFailed` through the table.
pub(super) async fn launch_legs(
    deps: &WorkflowActorDeps,
    run_id: &str,
    node: &WorkflowRunNodeRecord,
    definition: &WorkflowDefinition,
    workspace_id: &str,
    arguments_json: &str,
) -> anyhow::Result<()> {
    let prompts = leg_prompts(node, definition);
    let (agent_kind, model_id, mode_id) = launch_model(node, definition);
    let workspace = deps
        .workspace_store
        .find_by_id(workspace_id)?
        .ok_or_else(|| anyhow::anyhow!("workspace {workspace_id} not found for fan-out render"))?;
    let arguments: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(arguments_json)?;

    // Render + mint + link every leg first; the representative is leg 0.
    let mut legs: Vec<(i64, SessionRecord, RenderedEnvelope)> = Vec::with_capacity(prompts.len());
    for (index, prompt) in prompts.iter().enumerate() {
        let envelope = match render_leg(deps, run_id, node, &workspace.path, &arguments, prompt) {
            Ok(envelope) => envelope,
            Err(error) => {
                compensate_all(deps, &legs).await;
                return Err(error);
            }
        };
        let input = InternalSessionCreateInput {
            workspace_id: workspace.id.clone(),
            agent_kind: agent_kind.clone(),
            model_id: model_id.clone(),
            mode_id: mode_id.clone(),
            origin: OriginContext::system_local_runtime(),
            preselected_session_id: None,
        };
        let session_runtime = deps.session_runtime.clone();
        let session = match tokio::task::spawn_blocking(move || {
            session_runtime.create_persisted_internal_session(input)
        })
        .await
        {
            Ok(Ok(session)) => session,
            Ok(Err(error)) => {
                compensate_all(deps, &legs).await;
                return Err(anyhow::anyhow!("leg session create failed: {error:?}"));
            }
            Err(join) => {
                compensate_all(deps, &legs).await;
                return Err(anyhow::anyhow!("leg session create join failed: {join}"));
            }
        };
        if let Err(error) = deps
            .session_store
            .link_workflow_columns(&session.id, run_id, &node.id)
        {
            deps.session_runtime
                .compensate_new_agent_session(&session.id)
                .await
                .ok();
            compensate_all(deps, &legs).await;
            return Err(error);
        }
        legs.push((index as i64, session, envelope));
    }

    // One transaction: representative stamp + N ledger rows (ruling F5).
    let ledger: Vec<(i64, String)> = legs
        .iter()
        .map(|(index, session, _)| (*index, session.id.clone()))
        .collect();
    let rep_envelope = legs.first().map(|(_, _, envelope)| envelope.clone());
    let rep_prompt_id = format!("wf2-{}", node.id);
    if let Err(error) = deps
        .store
        .stamp_fanout(&node.id, Some(&rep_prompt_id), Some(&agent_kind), &ledger)
    {
        compensate_all(deps, &legs).await;
        return Err(error);
    }
    if let Some(envelope) = &rep_envelope {
        deps.store.store_rendered_envelope(&node.id, envelope).ok();
    }

    // Start + dispatch each leg; leg 0 keeps the representative prompt id.
    for (index, session, envelope) in &legs {
        let prompt_id = if *index == 0 {
            rep_prompt_id.clone()
        } else {
            format!("wf2-{}-l{}", node.id, index)
        };
        if let Err(error) = start_and_dispatch(deps, run_id, node, session, envelope, prompt_id).await
        {
            compensate_all(deps, &legs).await;
            return Err(error);
        }
    }
    Ok(())
}

/// Start one leg's session and dispatch its wrapped envelope in-band (Ruling
/// D). A lost acknowledgement leaves the leg running (the fence resolves it);
/// a hard dispatch error bubbles.
async fn start_and_dispatch(
    deps: &WorkflowActorDeps,
    run_id: &str,
    node: &WorkflowRunNodeRecord,
    session: &SessionRecord,
    envelope: &RenderedEnvelope,
    prompt_id: String,
) -> anyhow::Result<()> {
    deps.session_runtime
        .start_persisted_session(session)
        .await
        .map_err(|error| anyhow::anyhow!("leg session start failed: {error:?}"))?;
    let mut texts = envelope.instruction_blocks.clone();
    texts.push(envelope.first_message.clone());
    match deps
        .session_runtime
        .send_text_blocks_prompt_with_id(&session.id, texts, prompt_id)
        .await
    {
        Ok(_) => Ok(()),
        Err(TextPromptDispatchError::AcknowledgementLost) => {
            tracing::warn!(
                run_id = %run_id,
                node_row_id = %node.id,
                session_id = %session.id,
                "workflow leg envelope acknowledgement lost; leaving the leg running",
            );
            Ok(())
        }
        Err(TextPromptDispatchError::Dispatch(error)) => {
            Err(anyhow::anyhow!("leg envelope dispatch failed: {error:?}"))
        }
    }
}

/// Best-effort compensation of every already-minted leg session on a failed
/// fan-out — the rows already tell the truth, so a cleanup miss only leaves a
/// closable session behind.
async fn compensate_all(deps: &WorkflowActorDeps, legs: &[(i64, SessionRecord, RenderedEnvelope)]) {
    for (_, session, _) in legs {
        deps.session_runtime
            .compensate_new_agent_session(&session.id)
            .await
            .ok();
        deps.session_store.clear_workflow_columns(&session.id).ok();
    }
}
