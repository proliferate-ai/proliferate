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
use crate::domains::workflows::render::{
    node_session_title, render_envelope, run_context_dir_relative, RenderInputs,
};
use crate::domains::workflows::transition::RunState;
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

/// The fallible tail of the single-node launch, split out so `launch_node` can
/// compensate the freshly created session on ANY failure in here. Moved off
/// `actor.rs` to keep that seam under its 600-line ratchet.
pub(super) async fn link_start_and_dispatch(
    deps: &WorkflowActorDeps,
    run_id: &str,
    node: &WorkflowRunNodeRecord,
    session: &SessionRecord,
    envelope: &RenderedEnvelope,
    agent_kind: &str,
) -> anyhow::Result<()> {
    // Link and stamp BEFORE start: the launch extras resolve the envelope
    // through the sessions columns, and the extension matches turn reports
    // through them.
    let prompt_id = format!("wf2-{}", node.id);
    deps.session_store
        .link_workflow_columns(&session.id, run_id, &node.id)?;
    title_node_session(deps, run_id, node, &session.id);
    deps.store
        .stamp_session(&node.id, &session.id, Some(&prompt_id), Some(agent_kind))?;

    deps.session_runtime
        .start_persisted_session(session)
        .await
        .map_err(|error| anyhow::anyhow!("session start failed: {error:?}"))?;

    // Ruling D: the wrapped instruction blocks ride IN-BAND as leading text
    // blocks of the first prompt — identical for every harness — and the node's
    // first message is always the LAST block.
    let mut texts = envelope.instruction_blocks.clone();
    texts.push(envelope.first_message.clone());
    match deps
        .session_runtime
        .send_text_blocks_prompt_with_id(&session.id, texts, prompt_id)
        .await
    {
        Ok(_running_or_queued) => Ok(()),
        Err(TextPromptDispatchError::AcknowledgementLost) => {
            // A lost acknowledgement is never a failure claim — the turn may be
            // running. The extension or the fence resolves the row. No
            // compensation: the session may be live.
            tracing::warn!(
                run_id = %run_id,
                node_row_id = %node.id,
                session_id = %session.id,
                "workflow envelope acknowledgement lost; leaving the node running",
            );
            Ok(())
        }
        Err(TextPromptDispatchError::Dispatch(error)) => {
            Err(anyhow::anyhow!("envelope dispatch failed: {error:?}"))
        }
    }
}

/// Render a single node's envelope (the non-fan-out launch path). Moved off
/// `actor.rs` to keep that seam under its 600-line ratchet. Ruling E: a defined
/// node's prompt was validated before the snapshot froze and renders strict;
/// redo-edited and adhoc prompts are user-typed and render lenient.
pub(super) fn render_node_envelope(
    deps: &WorkflowActorDeps,
    run_id: &str,
    state: &RunState,
    node: &WorkflowRunNodeRecord,
) -> anyhow::Result<RenderedEnvelope> {
    let workspace = deps
        .workspace_store
        .find_by_id(&state.run.workspace_id)?
        .ok_or_else(|| {
            anyhow::anyhow!("workspace {} not found for render", state.run.workspace_id)
        })?;
    let arguments: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&state.run.arguments_json)?;
    let docs = deps.store.list_docs(run_id)?;
    let context_dir = Path::new(&workspace.path).join(run_context_dir_relative(run_id));
    render_envelope(&RenderInputs {
        node_type: node.node_type,
        prompt: &node.prompt,
        mode: if node.kind == WorkflowNodeKind::Defined {
            ResolveMode::Strict
        } else {
            ResolveMode::Lenient
        },
        arguments: &arguments,
        docs: &docs,
        context_dir: &context_dir,
    })
    .map_err(|error| anyhow::anyhow!("envelope render failed: {error}"))
}

/// Actor entry for per-leg redo (rung 6): resolve the node and frozen
/// definition off the cached state, relaunch the one addressed leg, and return
/// the freshly stamped run state so the caller can catch its cache up. Keeps
/// the resolution + reload off `actor.rs` (its 600-line seam).
pub(super) async fn relaunch_leg(
    deps: &WorkflowActorDeps,
    run_id: &str,
    state: &RunState,
    node_row_id: &str,
    leg_index: i64,
) -> anyhow::Result<Option<RunState>> {
    let node = state
        .node(node_row_id)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("node row {node_row_id} not in run state"))?;
    let definition: WorkflowDefinition = serde_json::from_str(&state.run.definition_json)?;
    launch_one_leg(
        deps,
        run_id,
        &node,
        &definition,
        &state.run.workspace_id,
        &state.run.arguments_json,
        leg_index,
    )
    .await?;
    Ok(deps.store.load_run_state(run_id)?)
}

/// Per-leg redo relaunch (rung 6): render leg `leg_index`'s prompt, mint one
/// session, re-stamp that ledger row (resetting it to running with the fresh
/// session), then start and dispatch. Sibling legs are untouched. Any failure
/// compensates the freshly minted session and bubbles so the actor feeds
/// `NodeLaunchFailed` through the table, exactly as the fan-out path does.
pub(super) async fn launch_one_leg(
    deps: &WorkflowActorDeps,
    run_id: &str,
    node: &WorkflowRunNodeRecord,
    definition: &WorkflowDefinition,
    workspace_id: &str,
    arguments_json: &str,
    leg_index: i64,
) -> anyhow::Result<()> {
    let prompts = leg_prompts(node, definition);
    let prompt = prompts
        .get(leg_index as usize)
        .ok_or_else(|| anyhow::anyhow!("leg_index {leg_index} out of range for node {}", node.id))?
        .clone();
    let (agent_kind, model_id, mode_id) = launch_model(node, definition);
    let workspace = deps
        .workspace_store
        .find_by_id(workspace_id)?
        .ok_or_else(|| anyhow::anyhow!("workspace {workspace_id} not found for leg redo render"))?;
    let arguments: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(arguments_json)?;

    let envelope = render_leg(deps, run_id, node, &workspace.path, &arguments, &prompt)?;
    let input = InternalSessionCreateInput {
        workspace_id: workspace.id.clone(),
        agent_kind: agent_kind.clone(),
        model_id: model_id.clone(),
        mode_id: mode_id.clone(),
        origin: OriginContext::system_local_runtime(),
        preselected_session_id: None,
    };
    let session_runtime = deps.session_runtime.clone();
    let session =
        match tokio::task::spawn_blocking(move || session_runtime.create_persisted_internal_session(input))
            .await
        {
            Ok(Ok(session)) => session,
            Ok(Err(error)) => return Err(anyhow::anyhow!("leg session create failed: {error:?}")),
            Err(join) => return Err(anyhow::anyhow!("leg session create join failed: {join}")),
        };
    // One-element leg vec so the fan-out compensation helper applies verbatim.
    let legs = vec![(leg_index, session.clone(), envelope.clone())];

    if let Err(error) = deps
        .session_store
        .link_workflow_columns(&session.id, run_id, &node.id)
    {
        compensate_all(deps, &legs).await;
        return Err(error);
    }
    let prompt_id = if leg_index == 0 {
        format!("wf2-{}", node.id)
    } else {
        format!("wf2-{}-l{}", node.id, leg_index)
    };
    if let Err(error) =
        deps.store
            .stamp_leg_relaunch(&node.id, leg_index, &session.id, Some(&prompt_id), Some(&agent_kind))
    {
        compensate_all(deps, &legs).await;
        return Err(error);
    }
    if leg_index == 0 {
        deps.store.store_rendered_envelope(&node.id, &envelope).ok();
    }
    if let Err(error) = start_and_dispatch(deps, run_id, node, &session, &envelope, prompt_id).await {
        compensate_all(deps, &legs).await;
        return Err(error);
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

/// Name the node's session after the node, before the stamp that first
/// makes that session findable from the projection: a client raising a tab
/// for it never has to show the harness's own guess (which echoes the
/// first message, preamble and all) or the bare agent name.
///
/// Written unconditionally, and it stays: the two writers that can follow
/// — the harness info update and the prompt-derived fallback — are both
/// if-absent, so only a deliberate rename replaces it.
///
/// Cosmetic, so a failure is logged and the launch continues: an untitled
/// node session is still a working one.
fn title_node_session(
    deps: &WorkflowActorDeps,
    run_id: &str,
    node: &WorkflowRunNodeRecord,
    session_id: &str,
) {
    let title = node_session_title(node.chain_index, &node.title);
    let now = chrono::Utc::now().to_rfc3339();
    if let Err(error) = deps.session_store.update_title(session_id, &title, &now) {
        tracing::warn!(
            run_id = %run_id,
            node_row_id = %node.id,
            session_id = %session_id,
            error = %error,
            "workflow node session title write failed; leaving the session untitled",
        );
    }
}
