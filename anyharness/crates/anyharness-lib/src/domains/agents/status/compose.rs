//! Composing the status document's non-probe half (module docs, items 1–5).
//!
//! Split out of `mod.rs` for two reasons. The obvious one is size. The load
//! bearing one is that EVERY line here is I/O or pure derivation and NONE of it
//! may run inside the store's transaction: the persist's atomicity argument is
//! precisely "compose outside, decide the probe block inside", and keeping the
//! composition in its own file makes a future edit that reaches for the
//! transaction from here obvious rather than subtle.

use chrono::Utc;

use super::doc::{
    AppliedMethod, ComposedBody, MethodRow, METHOD_KIND_API_KEY, METHOD_KIND_GATEWAY,
    METHOD_KIND_NATIVE, METHOD_KIND_SEAT, OFFER_MINT_SEAT,
};
use super::AgentStatusService;
use crate::domains::agents::auth::credentials::detect_cli_auth_state;
use crate::domains::agents::model::{AgentKind, CliAuthState};
use crate::domains::agents::registry;
use crate::domains::agents::route_auth::profile::{
    resolve_profile, AgentRuntimeAuthProfile, HarnessSources, ResolvedSource,
};
use crate::domains::agents::route_auth::rotation::seat_rotation_readout_for_state;
use crate::domains::agents::route_auth::{current_server_origin, load_effective_state};

impl AgentStatusService {
    /// Compose one harness's document body from the live inputs.
    ///
    /// The applied document is loaded ONCE and threaded into every derivation
    /// that needs it (the profile AND the seat-rotation readout). Loading it
    /// twice mixed two auth worlds into one document: `applied.seat_id` could
    /// name a seat that the method rows — composed from the other read — did
    /// not contain at all.
    pub(super) fn compose_body(&self, harness_kind: &str) -> ComposedBody {
        let state = load_effective_state(&self.runtime_home, current_server_origin().as_deref())
            .ok()
            .flatten();
        // Native / absent / unsatisfiable all compose the same "no available
        // methods" document: availability means material a launch could use.
        let sources = match resolve_profile(state.as_ref(), harness_kind) {
            Ok(AgentRuntimeAuthProfile::Sources(sources)) => Some(sources),
            _ => None,
        };
        let rotate = sources
            .as_ref()
            .map(|sources| sources.rotate)
            .unwrap_or(true);
        let descriptor = registry::descriptor(harness_kind);
        let readout = seat_rotation_readout_for_state(
            state.as_ref(),
            harness_kind,
            &self.seat_cooling,
            Utc::now().timestamp(),
        );

        let seat_pool = seat_pool(sources.as_ref());
        let serving_seat = if seat_pool.is_empty() {
            None
        } else {
            readout
                .serving_seat_id
                .clone()
                .or_else(|| seat_pool.first().cloned())
        };
        let applied = applied_method(sources.as_ref(), &seat_pool, serving_seat.as_deref());

        let mut methods = Vec::new();
        let declared_seat = descriptor
            .as_ref()
            .is_some_and(|descriptor| descriptor.kind == AgentKind::Claude);
        if declared_seat {
            for seat_id in &seat_pool {
                methods.push(MethodRow {
                    kind: METHOD_KIND_SEAT.to_string(),
                    available: Some(true),
                    seat_id: Some(seat_id.clone()),
                    applied: serving_seat.as_deref() == Some(seat_id.as_str()),
                    detected: None,
                    offer: None,
                });
            }
        }
        let declared_gateway = descriptor.as_ref().is_some_and(|descriptor| {
            descriptor.auth.slots.iter().any(|slot| {
                slot.id == METHOD_KIND_GATEWAY || slot.materialization.gateway_env.is_some()
            })
        });
        if declared_gateway
            && has_source(sources.as_ref(), |source| {
                matches!(source, ResolvedSource::Gateway(_))
            })
        {
            methods.push(MethodRow {
                kind: METHOD_KIND_GATEWAY.to_string(),
                available: Some(true),
                seat_id: None,
                applied: applied_kind_is(applied.as_ref(), METHOD_KIND_GATEWAY),
                detected: None,
                offer: None,
            });
        }
        let declared_api_key = descriptor.as_ref().is_some_and(|descriptor| {
            descriptor
                .auth
                .slots
                .iter()
                .any(|slot| !slot.env_vars.is_empty())
        });
        if declared_api_key
            && has_source(sources.as_ref(), |source| {
                matches!(
                    source,
                    ResolvedSource::ApiKey(_) | ResolvedSource::ProviderConfig(_)
                )
            })
        {
            methods.push(MethodRow {
                kind: METHOD_KIND_API_KEY.to_string(),
                available: Some(true),
                seat_id: None,
                applied: applied_kind_is(applied.as_ref(), METHOD_KIND_API_KEY),
                detected: None,
                offer: None,
            });
        }
        // An unresolvable home means NO native detection. It emphatically does
        // not mean "detect against `/`": that made every detection probe walk
        // the filesystem root.
        if let (Some(descriptor), Some(detection_home)) =
            (descriptor.as_ref(), self.detection_home.as_ref())
        {
            if detect_cli_auth_state(&descriptor.auth, detection_home)
                == Some(CliAuthState::Authenticated)
            {
                methods.push(MethodRow {
                    kind: METHOD_KIND_NATIVE.to_string(),
                    available: None,
                    seat_id: None,
                    applied: false,
                    detected: Some(true),
                    offer: declared_seat.then(|| OFFER_MINT_SEAT.to_string()),
                });
            }
        }

        ComposedBody {
            methods,
            applied,
            next_seat_id: readout.next_seat_id,
            rotate,
            cooling_until: readout.cooling_until,
        }
    }
}

fn seat_pool(sources: Option<&HarnessSources>) -> Vec<String> {
    sources
        .map(|sources| {
            sources
                .sources
                .iter()
                .filter_map(|source| match source {
                    ResolvedSource::Seat(seat) => Some(seat.seat_id.clone()),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default()
}

fn has_source(
    sources: Option<&HarnessSources>,
    predicate: impl Fn(&ResolvedSource) -> bool,
) -> bool {
    sources.is_some_and(|sources| sources.sources.iter().any(predicate))
}

/// The document's applied tag, from the applied document only: seats win (the
/// serving seat rides `seat_id`), else the first non-seat source's method
/// family in document order (`provider_config` is the api_key family's typed
/// variant, so it tags as `api_key`). `None` when the document gives the
/// harness no satisfiable sources.
fn applied_method(
    sources: Option<&HarnessSources>,
    seat_pool: &[String],
    serving_seat: Option<&str>,
) -> Option<AppliedMethod> {
    let sources = sources?;
    if !seat_pool.is_empty() {
        return Some(AppliedMethod {
            kind: METHOD_KIND_SEAT.to_string(),
            seat_id: serving_seat.map(str::to_string),
        });
    }
    sources.sources.first().map(|source| AppliedMethod {
        kind: match source {
            ResolvedSource::Gateway(_) => METHOD_KIND_GATEWAY.to_string(),
            ResolvedSource::ApiKey(_) | ResolvedSource::ProviderConfig(_) => {
                METHOD_KIND_API_KEY.to_string()
            }
            ResolvedSource::Seat(_) => METHOD_KIND_SEAT.to_string(),
        },
        seat_id: None,
    })
}

fn applied_kind_is(applied: Option<&AppliedMethod>, kind: &str) -> bool {
    applied.is_some_and(|applied| applied.kind == kind)
}
