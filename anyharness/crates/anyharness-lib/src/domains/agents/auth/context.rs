//! Pure auth-context classification (migration §5.4 layer 4): credential
//! facts × catalog v2 ordered signatures → `ActiveAuthContexts`.
//!
//! Rules (decisions ledger 7/8):
//! - ONE winner per auth slot — the FIRST context in catalog order whose
//!   signals match; list order IS the harness's own credential precedence
//!   (probe-validated, e.g. an inherited API key masks an OAuth token).
//! - UNION across slots (opencode-style multi-provider harnesses).
//! - `"baseline"` is active iff no context matched any slot.
//! - A context without signals NEVER matches: it is probe-only knowledge
//!   (the probe injected its credentials; the runtime has no detection
//!   signature for it yet).
//! - Facts must come from the COMPOSED launch env (workspace env + auth
//!   overlay), never the ambient process env — classifying ambient would
//!   reproduce the probe env-leak bug in production. Secrets rule: values
//!   are readable only for registry-declared flag vars (`EnvFlag` facts).
//!
//! Everything here is pure: no IO, no clock, no `&self` — call it anywhere.

use anyharness_credential_discovery::CredentialFact;
use serde::Serialize;

use crate::domains::agents::catalog::schema_v2::{
    AgentCatalogAuthSignal, AgentCatalogV2AuthContext,
};
use crate::domains::agents::model::{AgentDescriptor, AuthSpec, CredentialState};

/// Reserved catalog context id meaning "no credentials at all".
pub const BASELINE_CONTEXT_ID: &str = "baseline";

/// The classified auth contexts for one agent, ordered by slot appearance in
/// the catalog (each entry is its slot's first-match winner).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ActiveAuthContexts {
    ids: Vec<String>,
}

impl ActiveAuthContexts {
    pub fn ids(&self) -> &[String] {
        &self.ids
    }

    pub fn is_active(&self, id: &str) -> bool {
        self.ids.iter().any(|active| active == id)
    }

    /// True when classification fell through to `"baseline"` (no context
    /// matched any slot).
    pub fn is_baseline(&self) -> bool {
        self.ids.len() == 1 && self.ids[0] == BASELINE_CONTEXT_ID
    }

    /// The cloud-sync projection: context IDS ONLY — no facts, no values.
    /// TODO(PR-7b): serialize this on the worker registry-projection lane
    /// (target → cloud) so menus render from last-classified contexts.
    pub fn sync_summary(&self, agent_kind: &str) -> AuthContextSyncSummary {
        AuthContextSyncSummary {
            agent_kind: agent_kind.to_string(),
            active_context_ids: self.ids.clone(),
        }
    }
}

/// What crosses the target → cloud boundary about classification: ids only.
/// No credential fact, env var name, or value ever rides along (decisions
/// ledger 8). TODO(PR-7b): wire the transport (worker/server).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthContextSyncSummary {
    pub agent_kind: String,
    pub active_context_ids: Vec<String>,
}

/// Classify which of `contexts` (the agent's catalog v2 `authContexts`, in
/// document order) are active given the observed `facts`.
///
/// `descriptor` supplies the slot universe: a context referencing an auth
/// slot the runtime descriptor does not declare is skipped (catalog/registry
/// skew must never activate a slot the runtime cannot represent). Contexts
/// with `auth_slot_id: None` other than `"baseline"` are invalid per
/// validation and are likewise skipped here.
pub fn classify(
    descriptor: &AgentDescriptor,
    contexts: &[AgentCatalogV2AuthContext],
    facts: &[CredentialFact],
) -> ActiveAuthContexts {
    let mut winners: Vec<String> = Vec::new();
    let mut decided_slots: Vec<&str> = Vec::new();

    for context in contexts {
        if context.id == BASELINE_CONTEXT_ID {
            continue;
        }
        let Some(slot_id) = context.auth_slot_id.as_deref() else {
            tracing::debug!(
                agent_kind = descriptor.kind.as_str(),
                context_id = %context.id,
                "Skipping non-baseline auth context without auth slot id"
            );
            continue;
        };
        if descriptor.auth.slot(slot_id).is_none() {
            tracing::debug!(
                agent_kind = descriptor.kind.as_str(),
                context_id = %context.id,
                slot_id,
                "Skipping auth context for slot unknown to the descriptor"
            );
            continue;
        }
        if decided_slots.contains(&slot_id) {
            continue;
        }
        // No signals = probe-only context: never matches at runtime.
        let Some(signals) = context.signals.as_ref() else {
            continue;
        };
        if signal_matches(signals, facts) {
            decided_slots.push(slot_id);
            winners.push(context.id.clone());
        }
    }

    if winners.is_empty() {
        winners.push(BASELINE_CONTEXT_ID.to_string());
    }
    ActiveAuthContexts { ids: winners }
}

/// Signal evaluation over facts. `Env` matches presence — an `EnvFlag` fact
/// also proves its var is present. `EnvFlag` signals (`"VAR=value"`) require
/// an exact var+value `EnvFlag` fact; a malformed signal (no `=`) never
/// matches. Empty combinators never match (validation rejects them; the
/// conservative reading here means a broken document cannot unlock models).
fn signal_matches(signal: &AgentCatalogAuthSignal, facts: &[CredentialFact]) -> bool {
    match signal {
        AgentCatalogAuthSignal::Env(var) => facts.iter().any(|fact| match fact {
            CredentialFact::Env { var: fact_var } => fact_var == var,
            CredentialFact::EnvFlag { var: fact_var, .. } => fact_var == var,
            CredentialFact::Discovery { .. } => false,
        }),
        AgentCatalogAuthSignal::EnvFlag(spec) => {
            let Some((var, value)) = spec.split_once('=') else {
                tracing::debug!(signal = %spec, "Malformed envFlag signal never matches");
                return false;
            };
            facts.iter().any(|fact| {
                matches!(
                    fact,
                    CredentialFact::EnvFlag {
                        var: fact_var,
                        value: fact_value,
                    } if fact_var == var && fact_value == value
                )
            })
        }
        AgentCatalogAuthSignal::Discovery(kind) => facts.iter().any(|fact| {
            matches!(fact, CredentialFact::Discovery { kind: fact_kind } if fact_kind == kind)
        }),
        AgentCatalogAuthSignal::AnyOf(children) => children
            .iter()
            .any(|child| signal_matches(child, facts)),
        AgentCatalogAuthSignal::AllOf(children) => {
            !children.is_empty() && children.iter().all(|child| signal_matches(child, facts))
        }
    }
}

/// Layer-5 projection: today's `CredentialState` semantics derived from
/// classified facts, for agents whose catalog declares v2 auth contexts.
///
/// Mirrors the slot-level ladder in `credentials.rs::detect_slot_credentials`
/// exactly, in the same order:
/// 1. any declared slot env var present in facts → `Ready` (env beats
///    discovery, catalog or not — identical to today),
/// 2. some non-baseline context active (i.e. discovery-matched) →
///    `ReadyViaLocalAuth`,
/// 3. nothing + login supported → `LoginRequired`, else `MissingEnv`.
///
/// The legacy env + `LocalAuthState` path in `credentials.rs` stays
/// authoritative for the v1-catalog era; nothing is wired into readiness
/// here. TODO(PR-7b): readiness consumes this projection and the parallel
/// logic in `credentials.rs` is deleted, not duplicated.
pub fn project_credential_state(
    auth: &AuthSpec,
    active: &ActiveAuthContexts,
    facts: &[CredentialFact],
) -> CredentialState {
    let env_present = auth.expected_env_vars().iter().any(|var| {
        facts.iter().any(|fact| match fact {
            CredentialFact::Env { var: fact_var } => fact_var == var,
            CredentialFact::EnvFlag { var: fact_var, .. } => fact_var == var,
            CredentialFact::Discovery { .. } => false,
        })
    });
    if env_present {
        return CredentialState::Ready;
    }

    if !active.is_baseline() && !active.ids().is_empty() {
        return CredentialState::ReadyViaLocalAuth;
    }

    if auth.supports_login() {
        return CredentialState::LoginRequired;
    }

    CredentialState::MissingEnv
}
