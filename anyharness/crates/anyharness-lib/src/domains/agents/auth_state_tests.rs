//! Tier-1 tests for the canonical agent-auth evidence model.
//!
//! Two jobs: an INVARIANT SWEEP over fact permutations asserting that every
//! green output carries an `evidence_ref` and an `evidence_age`, and targeted
//! per-arm unit tests pinning each precedence terminal.

use super::*;

fn base_installed() -> AgentAuthFacts {
    AgentAuthFacts {
        installed: true,
        ..AgentAuthFacts::default()
    }
}

fn probe(phase: ProbePhase, age: Option<i64>, nonempty: bool) -> ProbeLifecycle {
    ProbeLifecycle {
        phase,
        last_success_age_seconds: age,
        last_failure_detail: None,
        next_attempt_at: None,
        observation_nonempty: nonempty,
    }
}

/// A resolved agent whose route supplies gateway credentials, installed and
/// otherwise healthy. Built from the real registry + resolver, then the two
/// route-derived fields the adapter reads are set, so the FR-2 runtime fold
/// (`facts_from_resolved_with_runtime`) is exercised end to end.
fn gateway_resolved() -> ResolvedAgent {
    use crate::domains::agents::readiness::service::resolve_agent_unrouted;
    use crate::domains::agents::registry::descriptor;
    let home = std::env::temp_dir();
    let desc = descriptor("claude").expect("claude descriptor");
    let mut resolved = resolve_agent_unrouted(&desc, &home);
    // Force the healthy, route-credentialed shape regardless of what a bare temp
    // home resolved to.
    resolved.status = ResolvedAgentStatus::Ready;
    resolved.credentials_from_route = true;
    resolved
}

#[test]
fn runtime_fold_upgrades_a_gateway_credential_on_a_green_trial() {
    let resolved = gateway_resolved();
    let runtime = AuthRuntimeInputs {
        probe: ProbeLifecycle::default(),
        trial: Some(Tier1TrialFact::Green { age_seconds: 12 }),
        gateway: None,
    };
    let facts = facts_from_resolved_with_runtime(&resolved, &runtime);

    let credential = facts.credential.as_ref().expect("gateway credential");
    assert_eq!(credential.strength, CredentialEvidenceStrength::Tier1Trial);
    assert_eq!(credential.evidence_age_seconds, Some(12));

    let derived = derive_agent_auth_state(&facts);
    assert_eq!(derived.display, AuthDisplay::Authenticated);
    assert_eq!(derived.evidence_ref, Some(EvidenceRef::GatewayKeyCheck));
    assert_eq!(derived.evidence_age_seconds, Some(12));
}

#[test]
fn a_green_trial_never_upgrades_a_non_gateway_credential() {
    // A pasted-key (BYOK) credential, not a gateway one.
    let mut resolved = gateway_resolved();
    resolved.credentials_from_route = false;
    resolved.credential_state = CredentialState::Ready;

    let runtime = AuthRuntimeInputs {
        probe: ProbeLifecycle::default(),
        trial: Some(Tier1TrialFact::Green { age_seconds: 5 }),
        gateway: None,
    };
    let facts = facts_from_resolved_with_runtime(&resolved, &runtime);

    let credential = facts.credential.as_ref().expect("byok credential");
    assert_eq!(credential.source, CredentialSource::ApiKeyByok);
    // The trial verifies a gateway key, so a green must NOT attach itself here.
    assert_eq!(
        credential.strength,
        CredentialEvidenceStrength::BarePresence
    );
    assert!(credential.evidence_age_seconds.is_none());
    assert!(
        !derive_agent_auth_state(&facts).display.is_green(),
        "a stray gateway trial must not turn a BYOK credential green"
    );
}

#[test]
fn runtime_fold_marks_expired_on_an_expired_trial() {
    let resolved = gateway_resolved();
    let runtime = AuthRuntimeInputs {
        probe: ProbeLifecycle::default(),
        trial: Some(Tier1TrialFact::Expired),
        gateway: None,
    };
    let facts = facts_from_resolved_with_runtime(&resolved, &runtime);
    assert!(facts.expired);
    assert_eq!(
        derive_agent_auth_state(&facts).display,
        AuthDisplay::Expired
    );
}

#[test]
fn runtime_fold_threads_the_real_probe_lifecycle() {
    let resolved = gateway_resolved();
    let runtime = AuthRuntimeInputs {
        probe: ProbeLifecycle {
            phase: ProbePhase::Backoff,
            last_failure_detail: Some("spawn_failed: no executable path".into()),
            next_attempt_at: Some("2026-08-15T00:00:00Z".into()),
            ..ProbeLifecycle::default()
        },
        trial: None,
        gateway: None,
    };
    let facts = facts_from_resolved_with_runtime(&resolved, &runtime);
    assert_eq!(facts.probe.phase, ProbePhase::Backoff);
    assert_eq!(
        facts.probe.next_attempt_at.as_deref(),
        Some("2026-08-15T00:00:00Z")
    );
    assert_eq!(
        facts.probe.last_failure_detail.as_deref(),
        Some("spawn_failed: no executable path")
    );
    // No trial and no observation: the credential stays at its heuristic strength.
    assert_eq!(
        facts.credential.as_ref().map(|c| c.strength),
        Some(CredentialEvidenceStrength::AcknowledgedRoute)
    );
}

// ---------------------------------------------------------------------------
// Per-arm precedence tests
// ---------------------------------------------------------------------------

#[test]
fn not_installed_beats_everything() {
    let facts = AgentAuthFacts {
        installed: false,
        unsupported_route: true,
        misconfigured: true,
        expired: true,
        probe: probe(ProbePhase::Running, Some(1), true),
        ..AgentAuthFacts::default()
    };
    let d = derive_agent_auth_state(&facts);
    assert_eq!(d.display, AuthDisplay::NotInstalled);
    assert_eq!(d.next_action, NextAction::Install);
}

#[test]
fn unsupported_route_terminal() {
    let facts = AgentAuthFacts {
        unsupported_route: true,
        misconfigured: true,
        expired: true,
        ..base_installed()
    };
    let d = derive_agent_auth_state(&facts);
    assert_eq!(d.display, AuthDisplay::Unsupported);
    assert_eq!(d.next_action, NextAction::None);
}

#[test]
fn misconfigured_beats_expired() {
    let facts = AgentAuthFacts {
        misconfigured: true,
        expired: true,
        ..base_installed()
    };
    let d = derive_agent_auth_state(&facts);
    assert_eq!(d.display, AuthDisplay::Misconfigured);
    assert_eq!(d.next_action, NextAction::FixConfig);
}

#[test]
fn expired_beats_a_green_probe() {
    // Even a fresh probe observation cannot mask a lapsed credential.
    let facts = AgentAuthFacts {
        expired: true,
        probe: probe(ProbePhase::Idle, Some(3), true),
        ..base_installed()
    };
    let d = derive_agent_auth_state(&facts);
    assert_eq!(d.display, AuthDisplay::Expired);
    assert_eq!(d.next_action, NextAction::LogInOrPasteKey);
}

#[test]
fn unavailable_when_gateway_selected_and_unreachable() {
    let facts = AgentAuthFacts {
        credential: Some(CredentialEvidence {
            source: CredentialSource::Gateway,
            strength: CredentialEvidenceStrength::AcknowledgedRoute,
            evidence_age_seconds: None,
        }),
        gateway: Some(GatewayHealth::Unreachable),
        ..base_installed()
    };
    let d = derive_agent_auth_state(&facts);
    assert_eq!(d.display, AuthDisplay::Unavailable);
    assert_eq!(d.next_action, NextAction::TopUpOrRetry);
}

#[test]
fn unavailable_on_budget_exhausted() {
    let facts = AgentAuthFacts {
        credential: Some(CredentialEvidence {
            source: CredentialSource::Gateway,
            strength: CredentialEvidenceStrength::AcknowledgedRoute,
            evidence_age_seconds: None,
        }),
        gateway: Some(GatewayHealth::BudgetExhausted),
        ..base_installed()
    };
    assert_eq!(
        derive_agent_auth_state(&facts).display,
        AuthDisplay::Unavailable
    );
}

#[test]
fn misconfigured_when_gateway_models_drifted() {
    let facts = AgentAuthFacts {
        credential: Some(CredentialEvidence {
            source: CredentialSource::Gateway,
            strength: CredentialEvidenceStrength::AcknowledgedRoute,
            evidence_age_seconds: None,
        }),
        gateway: Some(GatewayHealth::ModelsDrifted),
        ..base_installed()
    };
    let d = derive_agent_auth_state(&facts);
    assert_eq!(d.display, AuthDisplay::Misconfigured);
    assert_eq!(d.next_action, NextAction::FixConfig);
}

#[test]
fn expired_when_gateway_unauthorized() {
    let facts = AgentAuthFacts {
        credential: Some(CredentialEvidence {
            source: CredentialSource::Gateway,
            strength: CredentialEvidenceStrength::AcknowledgedRoute,
            evidence_age_seconds: None,
        }),
        gateway: Some(GatewayHealth::Unauthorized),
        ..base_installed()
    };
    let d = derive_agent_auth_state(&facts);
    assert_eq!(d.display, AuthDisplay::Expired);
    assert_eq!(d.next_action, NextAction::LogInOrPasteKey);
}

#[test]
fn gateway_unreachable_ignored_for_non_gateway_source() {
    // Gateway health only gates a gateway-sourced slot.
    let facts = AgentAuthFacts {
        credential: Some(CredentialEvidence {
            source: CredentialSource::ApiKeyByok,
            strength: CredentialEvidenceStrength::BarePresence,
            evidence_age_seconds: None,
        }),
        gateway: Some(GatewayHealth::Unreachable),
        ..base_installed()
    };
    assert_eq!(
        derive_agent_auth_state(&facts).display,
        AuthDisplay::Installed
    );
}

#[test]
fn probing_when_running() {
    let facts = AgentAuthFacts {
        probe: probe(ProbePhase::Running, None, false),
        ..base_installed()
    };
    let d = derive_agent_auth_state(&facts);
    assert_eq!(d.display, AuthDisplay::Probing);
    assert_eq!(d.next_action, NextAction::Wait);
}

#[test]
fn probing_when_queued() {
    let facts = AgentAuthFacts {
        probe: probe(ProbePhase::Queued, None, false),
        ..base_installed()
    };
    assert_eq!(
        derive_agent_auth_state(&facts).display,
        AuthDisplay::Probing
    );
}

#[test]
fn usable_on_fresh_nonempty_probe() {
    let facts = AgentAuthFacts {
        probe: probe(ProbePhase::Idle, Some(12), true),
        ..base_installed()
    };
    let d = derive_agent_auth_state(&facts);
    assert_eq!(d.display, AuthDisplay::Usable);
    assert_eq!(d.next_action, NextAction::None);
    assert_eq!(d.evidence_ref, Some(EvidenceRef::ProbeObservation));
    assert_eq!(d.evidence_age_seconds, Some(12));
}

#[test]
fn nonempty_probe_without_age_is_not_usable() {
    // The invariant guard: no age means no green.
    let facts = AgentAuthFacts {
        probe: probe(ProbePhase::Idle, None, true),
        ..base_installed()
    };
    let d = derive_agent_auth_state(&facts);
    assert!(!d.display.is_green());
}

#[test]
fn authenticated_on_tier1_trial() {
    let facts = AgentAuthFacts {
        credential: Some(CredentialEvidence {
            source: CredentialSource::Gateway,
            strength: CredentialEvidenceStrength::Tier1Trial,
            evidence_age_seconds: Some(4),
        }),
        ..base_installed()
    };
    let d = derive_agent_auth_state(&facts);
    assert_eq!(d.display, AuthDisplay::Authenticated);
    assert_eq!(d.next_action, NextAction::WaitForProbe);
    assert_eq!(d.evidence_ref, Some(EvidenceRef::GatewayKeyCheck));
    assert_eq!(d.evidence_age_seconds, Some(4));
}

#[test]
fn tier1_trial_without_age_is_not_green() {
    let facts = AgentAuthFacts {
        credential: Some(CredentialEvidence {
            source: CredentialSource::Gateway,
            strength: CredentialEvidenceStrength::Tier1Trial,
            evidence_age_seconds: None,
        }),
        ..base_installed()
    };
    assert!(!derive_agent_auth_state(&facts).display.is_green());
}

#[test]
fn usable_beats_authenticated() {
    let facts = AgentAuthFacts {
        credential: Some(CredentialEvidence {
            source: CredentialSource::Gateway,
            strength: CredentialEvidenceStrength::Tier1Trial,
            evidence_age_seconds: Some(4),
        }),
        probe: probe(ProbePhase::Idle, Some(2), true),
        ..base_installed()
    };
    assert_eq!(derive_agent_auth_state(&facts).display, AuthDisplay::Usable);
}

#[test]
fn selected_on_acknowledged_satisfiable_route() {
    let facts = AgentAuthFacts {
        credential: Some(CredentialEvidence {
            source: CredentialSource::Gateway,
            strength: CredentialEvidenceStrength::AcknowledgedRoute,
            evidence_age_seconds: None,
        }),
        selection: Some(SelectionFact {
            acknowledged: true,
            revision: Some(7),
            satisfiable: true,
            acknowledged_age_seconds: Some(30),
        }),
        ..base_installed()
    };
    let d = derive_agent_auth_state(&facts);
    assert_eq!(d.display, AuthDisplay::Selected);
    assert_eq!(d.next_action, NextAction::Wait);
    assert_eq!(d.evidence_ref, Some(EvidenceRef::AcknowledgedRoute));
    assert_eq!(d.evidence_age_seconds, Some(30));
}

#[test]
fn unsatisfiable_acknowledged_route_falls_to_installed() {
    let facts = AgentAuthFacts {
        selection: Some(SelectionFact {
            acknowledged: true,
            revision: Some(7),
            satisfiable: false,
            acknowledged_age_seconds: Some(30),
        }),
        ..base_installed()
    };
    assert_eq!(
        derive_agent_auth_state(&facts).display,
        AuthDisplay::Installed
    );
}

#[test]
fn installed_floor_for_bare_native_presence() {
    let facts = AgentAuthFacts {
        credential: Some(CredentialEvidence {
            source: CredentialSource::NativeLogin,
            strength: CredentialEvidenceStrength::BarePresence,
            evidence_age_seconds: None,
        }),
        ..base_installed()
    };
    let d = derive_agent_auth_state(&facts);
    assert_eq!(d.display, AuthDisplay::Installed);
    assert_eq!(d.next_action, NextAction::ChooseSource);
    assert!(!d.display.is_green());
}

// ---------------------------------------------------------------------------
// Invariant sweep over fact permutations
// ---------------------------------------------------------------------------

#[test]
fn invariant_every_green_output_carries_dated_evidence() {
    let sources = [
        CredentialSource::Gateway,
        CredentialSource::ApiKeyByok,
        CredentialSource::NativeLogin,
    ];
    let strengths = [
        CredentialEvidenceStrength::BarePresence,
        CredentialEvidenceStrength::AcknowledgedRoute,
        CredentialEvidenceStrength::Tier1Trial,
        CredentialEvidenceStrength::ProbeObservation,
    ];
    let phases = [
        ProbePhase::Idle,
        ProbePhase::Queued,
        ProbePhase::Running,
        ProbePhase::Backoff,
    ];
    let ages = [None, Some(0_i64), Some(90)];
    let gateways = [
        None,
        Some(GatewayHealth::Reachable),
        Some(GatewayHealth::Unreachable),
        Some(GatewayHealth::Unauthorized),
        Some(GatewayHealth::ModelsDrifted),
        Some(GatewayHealth::BudgetExhausted),
    ];
    let bools = [false, true];

    let mut green_seen = 0u32;
    let mut checked = 0u64;

    for &installed in &bools {
        for &unsupported_route in &bools {
            for &misconfigured in &bools {
                for &expired in &bools {
                    for &has_cred in &bools {
                        for &source in &sources {
                            for &strength in &strengths {
                                for &cred_age in &ages {
                                    for &has_sel in &bools {
                                        for &ack in &bools {
                                            for &sat in &bools {
                                                for &phase in &phases {
                                                    for &probe_age in &ages {
                                                        for &nonempty in &bools {
                                                            for &gateway in &gateways {
                                                                let facts = AgentAuthFacts {
                                                                    installed,
                                                                    unsupported_route,
                                                                    misconfigured,
                                                                    expired,
                                                                    credential: has_cred.then(|| {
                                                                        CredentialEvidence {
                                                                            source,
                                                                            strength,
                                                                            evidence_age_seconds:
                                                                                cred_age,
                                                                        }
                                                                    }),
                                                                    selection: has_sel.then(|| {
                                                                        SelectionFact {
                                                                            acknowledged: ack,
                                                                            revision: Some(1),
                                                                            satisfiable: sat,
                                                                            acknowledged_age_seconds:
                                                                                Some(5),
                                                                        }
                                                                    }),
                                                                    probe: probe(
                                                                        phase, probe_age, nonempty,
                                                                    ),
                                                                    gateway,
                                                                    handoff: None,
                                                                };
                                                                let d =
                                                                    derive_agent_auth_state(&facts);
                                                                checked += 1;
                                                                if d.display.is_green() {
                                                                    green_seen += 1;
                                                                    // THE INVARIANT.
                                                                    assert!(
                                                                        d.evidence_ref.is_some(),
                                                                        "green {:?} without evidence_ref from {:?}",
                                                                        d.display,
                                                                        facts
                                                                    );
                                                                    assert!(
                                                                        d.evidence_age_seconds
                                                                            .is_some(),
                                                                        "green {:?} without evidence_age from {:?}",
                                                                        d.display,
                                                                        facts
                                                                    );
                                                                    // Green is only ever probe- or
                                                                    // trial-licensed, never bare.
                                                                    assert!(matches!(
                                                                        d.evidence_ref,
                                                                        Some(EvidenceRef::ProbeObservation)
                                                                            | Some(EvidenceRef::GatewayKeyCheck)
                                                                    ));
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    assert!(checked > 10_000, "sweep too small: {checked}");
    assert!(green_seen > 0, "sweep never exercised a green output");
}

#[test]
fn invariant_bare_presence_never_green() {
    // A credential whose strongest evidence is bare presence, with no probe
    // observation, can never be green regardless of source or selection.
    for source in [
        CredentialSource::Gateway,
        CredentialSource::ApiKeyByok,
        CredentialSource::NativeLogin,
    ] {
        let facts = AgentAuthFacts {
            credential: Some(CredentialEvidence {
                source,
                strength: CredentialEvidenceStrength::BarePresence,
                evidence_age_seconds: Some(1),
            }),
            selection: Some(SelectionFact {
                acknowledged: true,
                revision: Some(1),
                satisfiable: true,
                acknowledged_age_seconds: Some(1),
            }),
            ..base_installed()
        };
        assert!(!derive_agent_auth_state(&facts).display.is_green());
    }
}
