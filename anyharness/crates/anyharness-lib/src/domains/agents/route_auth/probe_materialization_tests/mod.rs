//! The probe seam: phase-A read-only-ness, the composed materialization under a
//! substituted root (Proof B1), the launch recipes' sanitization as probe
//! fidelity (Proof B4), GC isolation, permissions, cleanup, and the conservative
//! orphan sweep (Proof B7's sweep leg).
//!
//! Proof-ledger ids are named on each test so a reviewer can map them.

// Shared by the sibling assertion files through `use super::*`.
#[allow(unused_imports)]
use std::collections::BTreeSet;
#[allow(unused_imports)]
use std::path::{Path, PathBuf};

#[allow(unused_imports)]
use serde_json::json;

use super::*;
use crate::domains::agents::route_auth::plan::GatewayModelPlan;
use crate::domains::agents::route_auth::profile::ResolvedSource;
use crate::domains::agents::route_auth::test_support::TempHome;

const GATEWAY_BASE_URL: &str = "https://llm.proliferate.ai";
const VK: &str = "sk-virtual-1234";

fn gateway_source(key: &str) -> serde_json::Value {
    json!({ "kind": "gateway", "base_url": GATEWAY_BASE_URL, "key": key })
}

fn api_key_source(env_var_name: &str, value: &str) -> serde_json::Value {
    json!({ "kind": "api_key", "env_var_name": env_var_name, "value": value })
}

fn state(sequence: i64, harnesses: serde_json::Value) -> serde_json::Value {
    json!({ "version": 2, "sequence": sequence, "harnesses": harnesses })
}

fn material_for(home: &TempHome, harness: &str) -> Result<ProbeAuthMaterial, RouteAuthError> {
    // Pass an explicit origin so the process-global env var never participates.
    probe_auth_material_for_server(home.path(), harness, None)
}

fn plan_with(models: &[&str]) -> GatewayModelPlan {
    GatewayModelPlan {
        models: models.iter().map(|model| model.to_string()).collect(),
    }
}

#[allow(dead_code)]
fn composed_sources(material: &ProbeAuthMaterial) -> Option<&[ResolvedSource]> {
    match material.profile() {
        AgentRuntimeAuthProfile::Sources(sources) => Some(&sources.sources),
        AgentRuntimeAuthProfile::Native => None,
    }
}

mod materialization_tests;
mod phase_a_tests;
mod sweep_tests;

/// Recursive listing of (path, mtime_nanos, len) under a root, for before/after
/// comparison.
pub(super) fn tree_snapshot(root: &Path) -> Vec<(PathBuf, i128, u64)> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let is_dir = entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
            let (mtime, len) = std::fs::metadata(&path)
                .map(|metadata| {
                    let mtime = metadata
                        .modified()
                        .ok()
                        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|duration| duration.as_nanos() as i128)
                        .unwrap_or_default();
                    (mtime, metadata.len())
                })
                .unwrap_or((0, 0));
            out.push((path.clone(), mtime, len));
            if is_dir {
                stack.push(path);
            }
        }
    }
    out.sort();
    out
}
