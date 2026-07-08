use std::collections::BTreeMap;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use anyharness_credential_discovery::{
    detect_local_auth_state as discover_local_auth_state, LocalAuthState, ProviderId,
};

use crate::domains::agents::model::{
    AuthReadinessPolicy, AuthSlotSpec, AuthSpec, CliAuthState, CredentialDiscoveryKind,
    CredentialState, ResolvedAuthSlot,
};

/// Determine the credential state for an agent by checking env vars first,
/// then running provider-specific local discovery, then falling back to
/// login-required or missing-env as appropriate.
pub fn detect_credentials(auth: &AuthSpec, home_dir: &Path) -> CredentialState {
    detect_auth_slots(auth, home_dir).0
}

pub fn detect_credentials_with_env(
    auth: &AuthSpec,
    home_dir: &Path,
    additional_env: &BTreeMap<String, String>,
) -> CredentialState {
    detect_auth_slots_with_env(auth, home_dir, additional_env).0
}

pub fn detect_auth_slots(
    auth: &AuthSpec,
    home_dir: &Path,
) -> (CredentialState, Vec<ResolvedAuthSlot>) {
    detect_auth_slots_with_env(auth, home_dir, &BTreeMap::new())
}

pub fn detect_auth_slots_with_env(
    auth: &AuthSpec,
    home_dir: &Path,
    additional_env: &BTreeMap<String, String>,
) -> (CredentialState, Vec<ResolvedAuthSlot>) {
    let slots = auth
        .slots
        .iter()
        .map(|slot| ResolvedAuthSlot {
            spec: slot.clone(),
            credential_state: detect_slot_credentials(slot, home_dir, additional_env),
        })
        .collect::<Vec<_>>();

    (aggregate_credential_state(auth, &slots), slots)
}

/// Compute the CLI-specific authentication state for an agent by checking ONLY
/// local auth files (env vars do not influence this state).
pub fn detect_cli_auth_state(auth: &AuthSpec, home_dir: &Path) -> Option<CliAuthState> {
    // Check if any slot has discoverable CLI auth
    let has_discovery = auth
        .slots
        .iter()
        .any(|slot| slot.discovery != CredentialDiscoveryKind::None);

    if !has_discovery {
        return Some(CliAuthState::Unsupported);
    }

    // Aggregate state: if any slot is authenticated → authenticated,
    // else if any expired → expired, else absent
    let mut found_authenticated = false;
    let mut found_expired = false;

    for slot in &auth.slots {
        match detect_local_auth(&slot.discovery, home_dir) {
            LocalAuthDetection::Present => {
                found_authenticated = true;
            }
            LocalAuthDetection::Expired => {
                found_expired = true;
            }
            LocalAuthDetection::Absent => {}
        }
    }

    if found_authenticated {
        Some(CliAuthState::Authenticated)
    } else if found_expired {
        Some(CliAuthState::Expired)
    } else {
        Some(CliAuthState::Absent)
    }
}

fn detect_slot_credentials(
    slot: &AuthSlotSpec,
    home_dir: &Path,
    additional_env: &BTreeMap<String, String>,
) -> CredentialState {
    if slot.env_vars.is_empty() && slot.discovery == CredentialDiscoveryKind::None {
        return CredentialState::MissingEnv;
    }

    if slot
        .env_vars
        .iter()
        .any(|var| additional_env.contains_key(var) || std::env::var(var).is_ok())
    {
        return CredentialState::Ready;
    }

    match detect_local_auth(&slot.discovery, home_dir) {
        LocalAuthDetection::Present => return CredentialState::ReadyViaLocalAuth,
        LocalAuthDetection::Expired => return CredentialState::LoginRequired,
        LocalAuthDetection::Absent => {}
    }

    if slot.login.is_some() {
        return CredentialState::LoginRequired;
    }

    CredentialState::MissingEnv
}

fn aggregate_credential_state(auth: &AuthSpec, slots: &[ResolvedAuthSlot]) -> CredentialState {
    match auth.readiness_policy {
        AuthReadinessPolicy::None | AuthReadinessPolicy::ProviderManaged => CredentialState::Ready,
        AuthReadinessPolicy::AnyRequiredSlot => {
            let required = required_slots(slots);
            if required.is_empty() {
                return CredentialState::Ready;
            }
            if required.iter().any(slot_is_ready) {
                return CredentialState::Ready;
            }
            preferred_missing_state(required)
        }
        AuthReadinessPolicy::AllRequiredSlots => {
            let required = required_slots(slots);
            if required.is_empty() || required.iter().all(|slot| slot_is_ready(slot)) {
                return CredentialState::Ready;
            }
            preferred_missing_state(required)
        }
    }
}

fn required_slots(slots: &[ResolvedAuthSlot]) -> Vec<&ResolvedAuthSlot> {
    slots
        .iter()
        .filter(|slot| slot.spec.required_for_readiness)
        .collect()
}

fn slot_is_ready(slot: &&ResolvedAuthSlot) -> bool {
    matches!(
        slot.credential_state,
        CredentialState::Ready | CredentialState::ReadyViaLocalAuth
    )
}

fn preferred_missing_state(slots: Vec<&ResolvedAuthSlot>) -> CredentialState {
    if slots
        .iter()
        .any(|slot| slot.credential_state == CredentialState::LoginRequired)
    {
        CredentialState::LoginRequired
    } else {
        CredentialState::MissingEnv
    }
}

/// Local auth detection result: present, expired (credentials exist but past
/// expiry), or absent.
enum LocalAuthDetection {
    Present,
    Expired,
    Absent,
}

/// Dispatches to the right provider-specific detector based on the discovery kind.
fn detect_local_auth(kind: &CredentialDiscoveryKind, home_dir: &Path) -> LocalAuthDetection {
    match kind {
        CredentialDiscoveryKind::None => LocalAuthDetection::Absent,
        CredentialDiscoveryKind::Claude => detect_shared_local_auth(ProviderId::Claude, home_dir),
        CredentialDiscoveryKind::Codex => detect_shared_local_auth(ProviderId::Codex, home_dir),
        CredentialDiscoveryKind::OpenCode => detect_opencode_local_auth(home_dir),
        CredentialDiscoveryKind::Cursor => {
            if detect_cursor_local_auth(home_dir) {
                LocalAuthDetection::Present
            } else {
                LocalAuthDetection::Absent
            }
        }
        CredentialDiscoveryKind::Grok => detect_shared_local_auth(ProviderId::Xai, home_dir),
    }
}

fn detect_shared_local_auth(provider: ProviderId, home_dir: &Path) -> LocalAuthDetection {
    match discover_local_auth_state(provider, home_dir) {
        Ok(LocalAuthState::Present(_)) => LocalAuthDetection::Present,
        Ok(LocalAuthState::Expired(_)) => LocalAuthDetection::Expired,
        Ok(LocalAuthState::Absent) => LocalAuthDetection::Absent,
        Err(err) => {
            tracing::warn!(provider = ?provider, error = %err, "Shared credential discovery failed");
            LocalAuthDetection::Absent
        }
    }
}

/// Check OpenCode-specific local auth file for any provider credential.
///
/// Checks:
/// - `~/.local/share/opencode/auth.json` for provider entries with `type: "api"` + `key`
///   or `type: "oauth"` + `access`, or `type: "wellknown"` + `token`.
/// OAuth entries with an `expires` field (seconds epoch) in the past are treated as expired.
fn detect_opencode_local_auth(home_dir: &Path) -> LocalAuthDetection {
    let path = home_dir
        .join(".local")
        .join("share")
        .join("opencode")
        .join("auth.json");
    let Some(data) = read_json_file(&path) else {
        return LocalAuthDetection::Absent;
    };
    let Some(obj) = data.as_object() else {
        return LocalAuthDetection::Absent;
    };

    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let mut found_expired = false;

    for (_provider, value) in obj {
        let Some(config) = value.as_object() else {
            continue;
        };
        let auth_type = config.get("type").and_then(|v| v.as_str()).unwrap_or("");

        let has_credential = auth_type == "api" && non_empty_string(config, "key")
            || auth_type == "oauth" && non_empty_string(config, "access")
            || auth_type == "wellknown" && non_empty_string(config, "token");

        if !has_credential {
            continue;
        }

        // For oauth entries, check expiry if the `expires` field is present
        if auth_type == "oauth" {
            if let Some(expires_secs) = config.get("expires").and_then(|v| v.as_u64()) {
                if expires_secs <= now_secs {
                    found_expired = true;
                    continue;
                }
            }
        }

        // Found a valid, non-expired credential
        return LocalAuthDetection::Present;
    }

    if found_expired {
        LocalAuthDetection::Expired
    } else {
        LocalAuthDetection::Absent
    }
}

fn non_empty_string(config: &serde_json::Map<String, serde_json::Value>, key: &str) -> bool {
    config
        .get(key)
        .and_then(|v| v.as_str())
        .is_some_and(|value| !value.is_empty())
}

/// Check Cursor-specific local login state.
///
/// Checks:
/// - `~/.cursor/cli-config.json` for `authInfo.userId` (set by `cursor-agent login`)
fn detect_cursor_local_auth(home_dir: &Path) -> bool {
    let path = home_dir.join(".cursor").join("cli-config.json");
    let Some(data) = read_json_file(&path) else {
        return false;
    };

    if let Some(user_id) = read_nested_string(&data, &["authInfo", "email"]) {
        if !user_id.is_empty() {
            return true;
        }
    }

    false
}

fn read_json_file(path: &Path) -> Option<serde_json::Value> {
    let contents = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&contents).ok()
}

fn read_nested_string<'a>(value: &'a serde_json::Value, path: &[&str]) -> Option<&'a str> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_str()
}

#[cfg(test)]
#[path = "credentials_tests.rs"]
mod tests;
