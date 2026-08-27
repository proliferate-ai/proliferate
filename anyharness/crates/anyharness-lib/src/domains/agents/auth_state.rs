//! Canonical per-harness agent-auth state (ADR FR-1: the evidence model).
//!
//! This is the additive successor to the several parallel ladders that project
//! agent-auth today (`CredentialState`, `ResolvedAgentStatus`, `CliAuthState`,
//! `credentialsFromRoute`). Those keep their meaning and their wire fields; this
//! module computes ONE more projection ALONGSIDE them and never changes their
//! outputs. Read surfaces still render the legacy ladder until the UI rung; this
//! rung only establishes the canonical model and serves it on the wire.
//!
//! The shape is deliberate: a struct of orthogonal FACTS
//! ([`AgentAuthFacts`]) plus ONE pure derivation ([`derive_agent_auth_state`])
//! that folds them into a display vocabulary by a fixed, first-match-wins
//! precedence. Every surface that wants "what auth state is this harness in"
//! calls the one derivation over the one fact struct, so two surfaces cannot
//! disagree by reimplementing the fold.
//!
//! The invariant the whole ADR exists to enforce lives in
//! [`derive_agent_auth_state`]: a GREEN display (`Usable` or `Authenticated`) is
//! reachable ONLY when `evidence_ref` names a probe observation, a key-scoped
//! gateway check, or an acknowledged applied route, each carrying a non-null
//! `evidence_age`. Bare file/keychain presence is UNVERIFIED and never renders
//! green.
//!
//! Several fact slots are typed here but not yet FILLED in this rung: the probe
//! lifecycle carries real vocabulary but a rung-2 adapter reports `Idle`
//! ([`facts_from_resolved`]); gateway health and the browser-login handoff are
//! `Option` placeholders filled by later rungs. Modeling the types now is what
//! lets the derivation handle them without a later shape change.

use crate::domains::agents::model::{CliAuthState, CredentialState, ResolvedAgent, ResolvedAgentStatus};

// ---------------------------------------------------------------------------
// Facts: orthogonal, surface-agnostic
// ---------------------------------------------------------------------------

/// Which source is filling the harness's auth slot for this scope.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialSource {
    /// The managed gateway virtual key minted for (subject, harness).
    Gateway,
    /// The user's own provider account through a bring-your-own key.
    ApiKeyByok,
    /// The harness's own native login (no route rows).
    NativeLogin,
}

/// The strongest evidence held that the slot's credential actually works,
/// ordered weakest to strongest in intent. Only the top two can license a green
/// display; [`Self::BarePresence`] is explicitly UNVERIFIED.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialEvidenceStrength {
    /// A file or keychain entry exists, but nothing has confirmed it works.
    /// Never green.
    BarePresence,
    /// The route was acknowledged/applied by the target runtime (monotonic
    /// revision), but no credential-scoped check has run yet.
    AcknowledgedRoute,
    /// A tier-1 trial (a cheap key-scoped gateway check) came back green.
    /// Placeholder strength wired in the probe-tiers rung.
    Tier1Trial,
    /// A full probe observation was recorded against this credential.
    ProbeObservation,
}

/// Credential evidence with provenance and the age of the strongest evidence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CredentialEvidence {
    pub source: CredentialSource,
    pub strength: CredentialEvidenceStrength,
    /// Age of the strongest evidence in seconds; `None` when the evidence has no
    /// timestamp (e.g. bare presence).
    pub evidence_age_seconds: Option<i64>,
}

/// The `state.json` route selection for this scope.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelectionFact {
    /// The target runtime acknowledged the applied route.
    pub acknowledged: bool,
    /// The acknowledged monotonic revision, when known.
    pub revision: Option<i64>,
    /// Whether the selected route can be satisfied (enrollment synced, key
    /// present, budget available).
    pub satisfiable: bool,
    /// Age of the acknowledgement in seconds, when known.
    pub acknowledged_age_seconds: Option<i64>,
}

/// The probe engine's live phase for this harness. Mirrors
/// `launch_probe::status::LiveState` vocabulary so a later rung can map one to
/// the other without a translation table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbePhase {
    Idle,
    Queued,
    Running,
    Backoff,
}

/// The probe lifecycle facts for this harness.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProbeLifecycle {
    pub phase: ProbePhase,
    /// Age of the last SUCCESSFUL observation in seconds.
    pub last_success_age_seconds: Option<i64>,
    /// Detail of the last failed attempt.
    pub last_failure_detail: Option<String>,
    /// RFC3339 timestamp of the next attempt, set only in `Backoff`.
    pub next_attempt_at: Option<String>,
    /// Whether the last successful observation carried a non-empty model list.
    pub observation_nonempty: bool,
}

impl Default for ProbeLifecycle {
    fn default() -> Self {
        Self {
            phase: ProbePhase::Idle,
            last_success_age_seconds: None,
            last_failure_detail: None,
            next_attempt_at: None,
            observation_nonempty: false,
        }
    }
}

/// Gateway health for a gateway-sourced slot, filled by the runtime data-plane
/// health check (ADR FR-3): one `GET /v1/models` per poke, shared with the
/// tier-1 trial, classified into orthogonal verdicts.
///
/// - `Reachable`: the gateway answered 2xx and its model list matches the
///   last-known list for this harness (or this is the first observation).
/// - `Unreachable`: a network/timeout error — the derivation reads `Unavailable`.
/// - `Unauthorized`: the gateway answered 401/403 — the derivation reads
///   `Expired` (the credential lapsed).
/// - `ModelsDrifted`: reachable AND authorized, but the model-list hash differs
///   from the last-known list — the derivation reads `Misconfigured`.
/// - `BudgetExhausted`: delivered via `state.json` (the budget fact), kept so the
///   derivation's `Unavailable` arm can fold it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GatewayHealth {
    Reachable,
    Unreachable,
    Unauthorized,
    ModelsDrifted,
    BudgetExhausted,
}

/// Browser-login handoff state. Placeholder slot; adapters arrive later.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoginHandoff {
    Initiated,
    AwaitingBrowser,
    Completed,
    Cancelled,
    TimedOut,
}

/// The full orthogonal fact struct for one harness in one scope.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentAuthFacts {
    /// The harness's artifacts resolved as installed.
    pub installed: bool,
    /// The render layer refuses a route for this selection (e.g. cursor gateway),
    /// or the runtime is incompatible.
    pub unsupported_route: bool,
    /// A control-plane delta or a probe config mismatch makes the applied world
    /// inconsistent with the selection.
    pub misconfigured: bool,
    /// A payload expiry passed, or a tier-1 auth check failed.
    pub expired: bool,
    pub credential: Option<CredentialEvidence>,
    pub selection: Option<SelectionFact>,
    pub probe: ProbeLifecycle,
    pub gateway: Option<GatewayHealth>,
    pub handoff: Option<LoginHandoff>,
}

impl Default for AgentAuthFacts {
    fn default() -> Self {
        Self {
            installed: false,
            unsupported_route: false,
            misconfigured: false,
            expired: false,
            credential: None,
            selection: None,
            probe: ProbeLifecycle::default(),
            gateway: None,
            handoff: None,
        }
    }
}

// ---------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------

/// The display vocabulary, in PRECEDENCE order (first match wins). Two
/// structural pre-ladder terminals lead.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthDisplay {
    NotInstalled,
    Unsupported,
    Misconfigured,
    Expired,
    Unavailable,
    Probing,
    Usable,
    Authenticated,
    Selected,
    Installed,
}

impl AuthDisplay {
    /// The two GREEN, launchable terminals. The invariant is defined against
    /// exactly this set.
    pub fn is_green(self) -> bool {
        matches!(self, AuthDisplay::Usable | AuthDisplay::Authenticated)
    }
}

/// The single suggested next action per display.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NextAction {
    /// Install the missing artifact.
    Install,
    /// Nothing to do (launchable, or a permanent refusal).
    None,
    /// Fix the configuration delta.
    FixConfig,
    /// Log in or paste a key to restore a lapsed credential.
    LogInOrPasteKey,
    /// Top up, retry, or wait on the gateway.
    TopUpOrRetry,
    /// Wait for the in-flight probe.
    Wait,
    /// Wait for the probe now that a trial is green.
    WaitForProbe,
    /// Choose a source, log in, or paste a key.
    ChooseSource,
}

/// Which piece of evidence licensed the derived display.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EvidenceRef {
    ProbeObservation,
    GatewayKeyCheck,
    AcknowledgedRoute,
}

/// The single derived output of [`derive_agent_auth_state`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DerivedState {
    pub display: AuthDisplay,
    pub next_action: NextAction,
    /// The evidence that licensed a green (or acknowledged) display. Always
    /// `Some` when `display.is_green()`.
    pub evidence_ref: Option<EvidenceRef>,
    /// Age of that evidence in seconds. Always `Some` when `display.is_green()`.
    pub evidence_age_seconds: Option<i64>,
}

/// The single shared derivation: fold the orthogonal facts into a display by a
/// fixed, first-match-wins precedence.
///
/// INVARIANT (asserted by the test sweep): if the returned `display.is_green()`,
/// then `evidence_ref` is `Some` naming a probe observation, a key-scoped gateway
/// check, or an acknowledged applied route, and `evidence_age_seconds` is `Some`.
/// A green display is unreachable from bare file/keychain presence.
pub fn derive_agent_auth_state(facts: &AgentAuthFacts) -> DerivedState {
    // Two structural pre-ladder terminals first.
    if !facts.installed {
        return DerivedState {
            display: AuthDisplay::NotInstalled,
            next_action: NextAction::Install,
            evidence_ref: None,
            evidence_age_seconds: None,
        };
    }
    if facts.unsupported_route {
        return DerivedState {
            display: AuthDisplay::Unsupported,
            next_action: NextAction::None,
            evidence_ref: None,
            evidence_age_seconds: None,
        };
    }

    // Configuration / credential-health terminals.
    if facts.misconfigured {
        return DerivedState {
            display: AuthDisplay::Misconfigured,
            next_action: NextAction::FixConfig,
            evidence_ref: None,
            evidence_age_seconds: None,
        };
    }
    if facts.expired {
        return DerivedState {
            display: AuthDisplay::Expired,
            next_action: NextAction::LogInOrPasteKey,
            evidence_ref: None,
            evidence_age_seconds: None,
        };
    }

    // A gateway-sourced slot, folded by its health verdict (ADR FR-3). A drifted
    // model list is a config delta (Misconfigured); a 401/403 is a lapsed
    // credential (Expired); an unreachable or budget-exhausted gateway is
    // Unavailable. The order below matches the display precedence
    // (Misconfigured < Expired < Unavailable).
    let gateway_selected = facts
        .credential
        .as_ref()
        .is_some_and(|c| c.source == CredentialSource::Gateway);
    if gateway_selected {
        match facts.gateway {
            Some(GatewayHealth::ModelsDrifted) => {
                return DerivedState {
                    display: AuthDisplay::Misconfigured,
                    next_action: NextAction::FixConfig,
                    evidence_ref: None,
                    evidence_age_seconds: None,
                };
            }
            Some(GatewayHealth::Unauthorized) => {
                return DerivedState {
                    display: AuthDisplay::Expired,
                    next_action: NextAction::LogInOrPasteKey,
                    evidence_ref: None,
                    evidence_age_seconds: None,
                };
            }
            Some(GatewayHealth::Unreachable) | Some(GatewayHealth::BudgetExhausted) => {
                return DerivedState {
                    display: AuthDisplay::Unavailable,
                    next_action: NextAction::TopUpOrRetry,
                    evidence_ref: None,
                    evidence_age_seconds: None,
                };
            }
            Some(GatewayHealth::Reachable) | None => {}
        }
    }

    // A probe in flight.
    if matches!(facts.probe.phase, ProbePhase::Running | ProbePhase::Queued) {
        return DerivedState {
            display: AuthDisplay::Probing,
            next_action: NextAction::Wait,
            evidence_ref: None,
            evidence_age_seconds: None,
        };
    }

    // GREEN #1 — a fresh, non-empty probe observation. Guarded on a non-null age
    // so the invariant holds by construction.
    if facts.probe.observation_nonempty {
        if let Some(age) = facts.probe.last_success_age_seconds {
            return DerivedState {
                display: AuthDisplay::Usable,
                next_action: NextAction::None,
                evidence_ref: Some(EvidenceRef::ProbeObservation),
                evidence_age_seconds: Some(age),
            };
        }
    }

    // GREEN #2 — a tier-1 trial came back green but no full probe has landed.
    // Only a credential whose STRONGEST evidence is the trial (with an age)
    // reaches here.
    if let Some(cred) = facts.credential.as_ref() {
        if cred.strength == CredentialEvidenceStrength::Tier1Trial {
            if let Some(age) = cred.evidence_age_seconds {
                return DerivedState {
                    display: AuthDisplay::Authenticated,
                    next_action: NextAction::WaitForProbe,
                    evidence_ref: Some(EvidenceRef::GatewayKeyCheck),
                    evidence_age_seconds: Some(age),
                };
            }
        }
    }

    // Selected — an acknowledged, satisfiable route with no trial or probe yet.
    // Not green.
    if let Some(sel) = facts.selection.as_ref() {
        if sel.acknowledged && sel.satisfiable {
            return DerivedState {
                display: AuthDisplay::Selected,
                next_action: NextAction::Wait,
                evidence_ref: Some(EvidenceRef::AcknowledgedRoute),
                evidence_age_seconds: sel.acknowledged_age_seconds,
            };
        }
    }

    // Installed floor: installed, but no verified/acknowledged path to a
    // credential. Bare presence lands here and is never green.
    DerivedState {
        display: AuthDisplay::Installed,
        next_action: NextAction::ChooseSource,
        evidence_ref: None,
        evidence_age_seconds: None,
    }
}

// ---------------------------------------------------------------------------
// Rung-2 fact adapter: build facts from the existing readiness projection
// ---------------------------------------------------------------------------

/// A tier-1 credential trial verdict, folded into the facts by
/// [`facts_from_resolved_with_runtime`] (ADR FR-2). Kept in this
/// dependency-free module so `launch_probe` (which depends on this module)
/// maps its own trial result onto this shape rather than the reverse.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier1TrialFact {
    /// A key-scoped gateway check came back green, with the age of the check.
    Green { age_seconds: i64 },
    /// The key-scoped check saw a 401/403 — the credential is lapsed.
    Expired,
}

/// The live runtime inputs a surface folds into the facts on top of the static
/// readiness projection: the probe engine's real lifecycle (ADR FR-2 item 3) and
/// an optional tier-1 trial verdict (ADR FR-2 item 1). Defaults reproduce the
/// rung-2 behavior exactly — an `Idle` probe and no trial — so the plain
/// [`facts_from_resolved`] stays a pure function of the resolved agent.
#[derive(Debug, Clone, Default)]
pub struct AuthRuntimeInputs {
    pub probe: ProbeLifecycle,
    pub trial: Option<Tier1TrialFact>,
    /// The runtime data-plane gateway health verdict (ADR FR-3), when the
    /// gateway-health check has an observation for this harness. Folded onto the
    /// facts only for a gateway-sourced credential.
    pub gateway: Option<GatewayHealth>,
    /// Seat rotation read-path facts (serving/next/cooling), computed by
    /// `route_auth::seat_rotation_readout` from the applied document + the
    /// seat-cooling store. Defaults to all-`None` (no seats).
    pub seat_rotation: SeatRotationReadout,
}

/// The pane-facing seat rotation derivation (agent_auth spec §4 cell 2's
/// serving-now / next-up tags + the cooling banner). Plain data; the frozen
/// semantics live on `route_auth::seat_rotation_readout`, its one producer.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SeatRotationReadout {
    /// The seat currently considered serving (last served if still in the
    /// applied pool, else the pool's first). `None` when the doc has no seats.
    pub serving_seat_id: Option<String>,
    /// The seat rotation would pick for the NEXT launch. `None` when the pool
    /// has fewer than two seats, or when no seat could serve.
    pub next_seat_id: Option<String>,
    /// RFC3339 UTC deadline, non-`None` ONLY when no seat can serve right now.
    pub cooling_until: Option<String>,
}

/// Build [`AgentAuthFacts`] from a resolved agent, using ONLY the data the
/// readiness projection already carries. The probe lifecycle stays `Idle` and no
/// trial is folded; [`facts_from_resolved_with_runtime`] adds the live inputs.
///
/// The mapping is intentionally conservative: nothing here fabricates a
/// tier-1 trial or a probe observation, so no path through this adapter can
/// yield a green display. That is the point — a locally-detected credential is
/// bare presence, which the derivation refuses to call green.
pub fn facts_from_resolved(resolved: &ResolvedAgent) -> AgentAuthFacts {
    facts_from_resolved_with_runtime(resolved, &AuthRuntimeInputs::default())
}

/// [`facts_from_resolved`] plus the live runtime inputs: the real probe
/// lifecycle and, when a tier-1 trial has a verdict, its fold onto the
/// credential and the `expired` terminal.
///
/// A green trial upgrades the gateway-sourced credential's strength to
/// [`CredentialEvidenceStrength::Tier1Trial`] with the check's age, which is the
/// ONLY way `facts_from_resolved`'s output can reach a green
/// [`AuthDisplay::Authenticated`] before a full probe lands. An expired trial
/// sets the `expired` terminal directly. Neither can manufacture a probe
/// observation, so the probe-first invariant is untouched.
pub fn facts_from_resolved_with_runtime(
    resolved: &ResolvedAgent,
    runtime: &AuthRuntimeInputs,
) -> AgentAuthFacts {
    let installed = !matches!(resolved.status, ResolvedAgentStatus::InstallRequired);
    let unsupported_route = matches!(resolved.status, ResolvedAgentStatus::Unsupported);
    // A resolution error is the closest current signal for an inconsistent
    // applied world; surface it as the config terminal rather than inventing a
    // new one.
    let misconfigured = matches!(resolved.status, ResolvedAgentStatus::Error);
    // A lapsed local credential OR a tier-1 trial that saw a 401/403 is expired.
    let expired = matches!(resolved.cli_auth_state, Some(CliAuthState::Expired))
        || matches!(runtime.trial, Some(Tier1TrialFact::Expired));

    let credential = if resolved.credentials_from_route {
        Some(CredentialEvidence {
            source: CredentialSource::Gateway,
            strength: CredentialEvidenceStrength::AcknowledgedRoute,
            evidence_age_seconds: None,
        })
    } else {
        match resolved.credential_state {
            CredentialState::ReadyViaLocalAuth => Some(CredentialEvidence {
                source: CredentialSource::NativeLogin,
                strength: CredentialEvidenceStrength::BarePresence,
                evidence_age_seconds: None,
            }),
            CredentialState::Ready => Some(CredentialEvidence {
                source: CredentialSource::ApiKeyByok,
                strength: CredentialEvidenceStrength::BarePresence,
                evidence_age_seconds: None,
            }),
            CredentialState::MissingEnv | CredentialState::LoginRequired => None,
        }
    };

    // A green tier-1 trial upgrades the credential it verified to the trial
    // strength with the check's age. Two guards keep this honest: only a
    // credential that actually exists is upgraded (a trial cannot conjure evidence
    // for a missing credential), and ONLY a GATEWAY-sourced credential is upgraded
    // — the tier-1 trial verifies a gateway virtual key, so folding its green onto
    // a native-login or pasted-key credential would attach `GatewayKeyCheck`
    // evidence to a credential it never checked. A lingering stale gateway verdict
    // therefore cannot promote a non-gateway credential.
    let credential = match (credential, runtime.trial) {
        (Some(mut evidence), Some(Tier1TrialFact::Green { age_seconds }))
            if evidence.source == CredentialSource::Gateway =>
        {
            evidence.strength = CredentialEvidenceStrength::Tier1Trial;
            evidence.evidence_age_seconds = Some(age_seconds);
            Some(evidence)
        }
        (credential, _) => credential,
    };

    let selection = if resolved.credentials_from_route {
        Some(SelectionFact {
            acknowledged: true,
            revision: None,
            satisfiable: true,
            acknowledged_age_seconds: None,
        })
    } else {
        None
    };

    // The gateway health verdict is only meaningful for a gateway-sourced
    // credential: a health check runs against the harness's gateway virtual key,
    // so folding it onto a native-login or pasted-key slot would attach a verdict
    // to a credential the check never observed. The derivation guards on the same
    // condition, but scrubbing it here keeps the facts honest for any reader.
    let gateway = match credential.as_ref() {
        Some(evidence) if evidence.source == CredentialSource::Gateway => runtime.gateway,
        _ => None,
    };

    AgentAuthFacts {
        installed,
        unsupported_route,
        misconfigured,
        expired,
        credential,
        selection,
        probe: runtime.probe.clone(),
        gateway,
        handoff: None,
    }
}

#[cfg(test)]
#[path = "auth_state_tests.rs"]
mod tests;
