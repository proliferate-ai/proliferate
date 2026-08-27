//! The per-harness status document (agent_auth spec §2, "Runtime persistent
//! state" · §4 cell 2, the `status/` tree): ONE machine truth per harness,
//! event-refreshed, never computed on read, served stale-marked while a
//! re-probe runs and never withdrawn. This module owns the document's
//! composition, its SQLite persistence, and its change stream; the local API
//! doors (`GET /v1/agent-auth/status`, `/status/stream`, `/methods`) serve it
//! verbatim, and the agents projection carries it as `authStatus`.
//!
//! Composition inputs, per refresh (spec §4 cell 2, "Method availability"):
//! 1. the applied document, through the SAME effective-state seam launches
//!    use (`route_auth::load_effective_state` + `resolve_profile`);
//! 2. the registry's declared auth vocabulary — a method row appears when the
//!    catalog declares the method AND its material is present in the applied
//!    document. **No org-policy input exists here by law**: policy gates
//!    writes and render on the server, never runtime availability;
//! 3. native detection (`detect_cli_auth_state`, read-only) — the `native`
//!    row with its `mint_seat` offer, never a launch method;
//! 4. the seat-rotation readout — serving (`applied.seat_id`), next-up, and
//!    the cooling banner;
//! 5. the settings rider `rotate` (parsed by `resolve_profile`);
//! 6. the probe evidence held beside the row (the serve-stale observation).
//!
//! Refreshing a harness whose recomposed document is byte-identical to the
//! persisted one neither publishes nor rewrites — changing one harness's auth
//! leaves every other harness's document byte-stable.
//!
//! Never logs or persists token material: documents carry seat ids and
//! verdicts only.

mod store;
#[cfg(test)]
mod tests;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::{DateTime, Utc};
use tokio::sync::broadcast;

pub use store::AgentStatusStore;
use store::ObservationWrite;

use crate::domains::agents::auth::credentials::detect_cli_auth_state;
use crate::domains::agents::launch_probe::targets::ProbeTargets;
use crate::domains::agents::launch_probe::{LaunchProbeService, PokeReason};
use crate::domains::agents::model::{AgentKind, CliAuthState};
use crate::domains::agents::registry;
use crate::domains::agents::route_auth::profile::{
    resolve_profile, AgentRuntimeAuthProfile, HarnessSources, ResolvedSource,
};
use crate::domains::agents::route_auth::rotation::seat_rotation_readout;
use crate::domains::agents::route_auth::{current_server_origin, load_effective_state};
use crate::domains::agents::seat_cooling::SeatCoolingStore;
use crate::persistence::Db;

/// The domain's status document (the wire twin is
/// `anyharness_contract::v1::StatusDoc`, mapped at the API boundary
/// per AH-CONTRACT-1). Serde derives live here because the document is
/// PERSISTED in this exact shape — `doc_json` is the served truth, and the
/// spec's printed snake_case shape is the contract for both the row and the
/// wire.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct StatusDoc {
    pub harness_kind: String,
    pub methods: Vec<MethodRow>,
    /// The applied method, from the applied document — never detection. The
    /// SERVING seat rides `applied.seat_id`. `None`/`null` when the document
    /// gives this harness no satisfiable sources.
    pub applied: Option<AppliedMethod>,
    pub next_seat_id: Option<String>,
    pub rotate: bool,
    pub probe: ProbeStatus,
    pub cooling_until: Option<String>,
}

/// One method row: launch methods carry `available`; the `native` row carries
/// `detected` (+ `offer`) and never `available`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct MethodRow {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub available: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seat_id: Option<String>,
    pub applied: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detected: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offer: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AppliedMethod {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seat_id: Option<String>,
}

/// The closed probe-verdict set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProbeVerdict {
    Verified,
    Failed,
    Unverified,
}

/// The serve-stale probe block: `stale` dims, the observation stays visible.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ProbeStatus {
    pub verdict: ProbeVerdict,
    pub at: Option<String>,
    pub stale: bool,
}

/// Method vocabulary on the document (the spec's three methods + the native
/// detection row).
pub const METHOD_KIND_SEAT: &str = "seat";
pub const METHOD_KIND_GATEWAY: &str = "gateway";
pub const METHOD_KIND_API_KEY: &str = "api_key";
pub const METHOD_KIND_NATIVE: &str = "native";
/// The native row's offer for seat-capable harnesses.
pub const OFFER_MINT_SEAT: &str = "mint_seat";

const OBSERVED_VERIFIED: &str = "verified";
const OBSERVED_FAILED: &str = "failed";

/// Why a refresh fired — trace vocabulary only; every cause runs the same
/// recomposition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefreshCause {
    /// The startup pass (every persisted row re-served stale until re-verified).
    Startup,
    /// An applied document change (the PUT/DELETE changed set).
    AuthApplied,
    /// A login terminal for this harness closed.
    LoginTerminal,
    /// A live session observed a seat limit hit and marked the seat cooling.
    SeatCooling,
}

impl RefreshCause {
    fn as_str(self) -> &'static str {
        match self {
            Self::Startup => "startup",
            Self::AuthApplied => "auth_applied",
            Self::LoginTerminal => "login_terminal",
            Self::SeatCooling => "seat_cooling",
        }
    }
}

/// The status-document service: reads, the change stream, event-driven
/// refreshes, and the probe-evidence writers the probe engine calls at
/// admission and completion (no polling seam — the engine pushes).
pub struct AgentStatusService {
    runtime_home: PathBuf,
    store: AgentStatusStore,
    seat_cooling: SeatCoolingStore,
    targets: Arc<dyn ProbeTargets>,
    /// The harness universe status documents may exist for (the registry's
    /// kinds in production; overridable in tests).
    universe: Vec<String>,
    /// The home dir native detection reads (the user's `$HOME` in production;
    /// a temp dir in tests so a developer's real logins cannot leak in).
    detection_home: PathBuf,
    publisher: broadcast::Sender<StatusDoc>,
}

impl AgentStatusService {
    pub fn new(db: Db, runtime_home: PathBuf, targets: Arc<dyn ProbeTargets>) -> Self {
        let universe = registry::built_in_registry()
            .iter()
            .map(|descriptor| descriptor.kind.as_str().to_string())
            .collect();
        let detection_home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
        Self::with_parts(db, runtime_home, targets, universe, detection_home)
    }

    pub(crate) fn with_parts(
        db: Db,
        runtime_home: PathBuf,
        targets: Arc<dyn ProbeTargets>,
        universe: Vec<String>,
        detection_home: PathBuf,
    ) -> Self {
        let (publisher, _) = broadcast::channel(64);
        Self {
            runtime_home,
            store: AgentStatusStore::new(db.clone()),
            seat_cooling: SeatCoolingStore::new(db),
            targets,
            universe,
            detection_home,
            publisher,
        }
    }

    /// Is this a harness the service can hold a document for? The doors 404
    /// on anything else.
    pub fn is_known_harness(&self, harness_kind: &str) -> bool {
        self.universe.iter().any(|kind| kind == harness_kind)
    }

    /// Every persisted status document, in harness order. Served truth — no
    /// composition happens on read.
    pub fn read_all(&self) -> Vec<StatusDoc> {
        self.store
            .read_all()
            .into_iter()
            .filter_map(|(harness_kind, doc_json)| parse_doc(&harness_kind, &doc_json))
            .collect()
    }

    pub fn read(&self, harness_kind: &str) -> Option<StatusDoc> {
        self.store
            .read(harness_kind)
            .and_then(|row| parse_doc(harness_kind, &row.doc_json))
    }

    /// The change stream: every persisted refresh publishes the changed
    /// document — one event per status-document change, nothing for
    /// byte-stable recompositions.
    pub fn subscribe(&self) -> broadcast::Receiver<StatusDoc> {
        self.publisher.subscribe()
    }

    /// Recompose one harness's document from the live inputs, carrying the
    /// probe block over unchanged (probe evidence moves only through the
    /// probe writers below).
    pub fn refresh(&self, harness_kind: &str, cause: RefreshCause) {
        let probe = self.stored_probe_block(harness_kind);
        let doc = self.compose(harness_kind, probe);
        self.persist(doc, ObservationWrite::Keep, cause.as_str());
    }

    pub fn refresh_harnesses(&self, harness_kinds: &[String], cause: RefreshCause) {
        for harness_kind in harness_kinds {
            self.refresh(harness_kind, cause);
        }
    }

    /// Refresh every known harness (the DELETE-with-unreadable-previous
    /// fallback: the widest honest targeting).
    pub fn refresh_all(&self, cause: RefreshCause) {
        for harness_kind in self.universe.clone() {
            self.refresh(&harness_kind, cause);
        }
    }

    /// A probe attempt was admitted (queued or running): the document goes
    /// stale, verdict and evidence unchanged — the last observation stays
    /// visible while the re-probe runs.
    pub fn probe_admitted(&self, harness_kind: &str) {
        let mut probe = self.stored_probe_block(harness_kind);
        probe.stale = true;
        let doc = self.compose(harness_kind, probe);
        self.persist(doc, ObservationWrite::Keep, "probe_admitted");
    }

    /// A probe succeeded: fresh evidence, and the observation store moves.
    pub fn probe_verified(&self, harness_kind: &str, at: DateTime<Utc>) {
        let at = at.to_rfc3339();
        let probe = ProbeStatus {
            verdict: ProbeVerdict::Verified,
            at: Some(at.clone()),
            stale: false,
        };
        let doc = self.compose(harness_kind, probe);
        self.persist(
            doc,
            ObservationWrite::Set {
                verdict: OBSERVED_VERIFIED,
                at: &at,
            },
            "probe_verified",
        );
    }

    /// A probe failed — the light dims, it never turns off (spec §3 flow 4):
    /// with a prior verified observation the document serves that observation
    /// stale-marked (the observation store is untouched); with none it serves
    /// an honest `failed` verdict at the attempt time — failed, not dark, not
    /// fabricated.
    pub fn probe_failed(&self, harness_kind: &str, at: DateTime<Utc>) {
        let prior_verified_at = self.store.read(harness_kind).and_then(|row| {
            (row.probe_verdict.as_deref() == Some(OBSERVED_VERIFIED))
                .then_some(row.probe_at)
                .flatten()
        });
        match prior_verified_at {
            Some(prior_at) => {
                let probe = ProbeStatus {
                    verdict: ProbeVerdict::Verified,
                    at: Some(prior_at),
                    stale: true,
                };
                let doc = self.compose(harness_kind, probe);
                self.persist(doc, ObservationWrite::Keep, "probe_failed");
            }
            None => {
                let at = at.to_rfc3339();
                let probe = ProbeStatus {
                    verdict: ProbeVerdict::Failed,
                    at: Some(at.clone()),
                    stale: false,
                };
                let doc = self.compose(harness_kind, probe);
                self.persist(
                    doc,
                    ObservationWrite::Set {
                        verdict: OBSERVED_FAILED,
                        at: &at,
                    },
                    "probe_failed",
                );
            }
        }
    }

    /// The startup pass: every persisted row is re-served STALE until the
    /// startup probes re-verify it (a restart invalidates live evidence, not
    /// the observation), every installed harness gets a row, and any
    /// installed, auto-probeable harness with NO persisted row — a harness
    /// that appeared without an install event — raises `FirstDetected`.
    pub fn startup_pass(&self, poke_engine: &Option<Arc<LaunchProbeService>>) {
        let persisted: Vec<String> = self
            .store
            .read_all()
            .into_iter()
            .map(|(harness_kind, _)| harness_kind)
            .collect();
        for harness_kind in &persisted {
            let mut probe = self.stored_probe_block(harness_kind);
            probe.stale = true;
            let doc = self.compose(harness_kind, probe);
            self.persist(doc, ObservationWrite::Keep, "startup");
        }
        let installed: Vec<String> = self
            .universe
            .iter()
            .filter(|kind| self.targets.is_installed(kind))
            .cloned()
            .collect();
        for harness_kind in &installed {
            if !persisted.iter().any(|kind| kind == harness_kind) {
                self.refresh(harness_kind, RefreshCause::Startup);
                if self.targets.allows_automatic_probe(harness_kind) {
                    LaunchProbeService::poke_optional(
                        poke_engine,
                        harness_kind,
                        PokeReason::FirstDetected,
                    );
                }
            }
        }
    }

    /// The stored document's probe block, or the unverified default for a
    /// harness with no row yet.
    fn stored_probe_block(&self, harness_kind: &str) -> ProbeStatus {
        self.store
            .read(harness_kind)
            .and_then(|row| parse_doc(harness_kind, &row.doc_json))
            .map(|doc| doc.probe)
            .unwrap_or(ProbeStatus {
                verdict: ProbeVerdict::Unverified,
                at: None,
                stale: false,
            })
    }

    /// Persist + publish, byte-stability gated: a recomposed document that is
    /// byte-identical to the persisted one (with no new observation to
    /// record) neither rewrites the row nor publishes an event.
    fn persist(&self, doc: StatusDoc, observation: ObservationWrite<'_>, why: &str) {
        let serialized = match serde_json::to_string(&doc) {
            Ok(serialized) => serialized,
            Err(error) => {
                tracing::warn!(harness_kind = %doc.harness_kind, %error, "failed to serialize agent-auth status document");
                return;
            }
        };
        if matches!(observation, ObservationWrite::Keep) {
            let unchanged = self
                .store
                .read(&doc.harness_kind)
                .is_some_and(|row| row.doc_json == serialized);
            if unchanged {
                return;
            }
        }
        self.store.upsert(
            &doc.harness_kind,
            &serialized,
            observation,
            Utc::now().timestamp(),
        );
        tracing::debug!(
            harness_kind = %doc.harness_kind,
            cause = why,
            "agent-auth status document refreshed"
        );
        let _ = self.publisher.send(doc);
    }

    /// Compose the document from the live inputs (module docs, items 1–5)
    /// plus the given probe block (item 6).
    fn compose(&self, harness_kind: &str, probe: ProbeStatus) -> StatusDoc {
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
        let readout = seat_rotation_readout(
            &self.runtime_home,
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
        if let Some(descriptor) = descriptor.as_ref() {
            if detect_cli_auth_state(&descriptor.auth, &self.detection_home)
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

        StatusDoc {
            harness_kind: harness_kind.to_string(),
            methods,
            applied,
            next_seat_id: readout.next_seat_id,
            rotate,
            probe,
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

fn parse_doc(harness_kind: &str, doc_json: &str) -> Option<StatusDoc> {
    match serde_json::from_str(doc_json) {
        Ok(doc) => Some(doc),
        Err(error) => {
            tracing::warn!(harness_kind, %error, "persisted agent-auth status document is malformed; skipping");
            None
        }
    }
}

/// The absolute path arm of the doc — kept for parity with the other stores'
/// constructors that take the shared app `Db`.
impl AgentStatusService {
    pub fn runtime_home(&self) -> &Path {
        &self.runtime_home
    }
}
