//! The per-(harness, auth context) auth fingerprint.
//!
//! One digest over everything that would change what a launch of this context
//! resolves to: the credential values (already hashed in phase A, so no plaintext
//! reaches this module), the gateway base URL, and the mtime+size of the discovery
//! files that context's signals name.
//!
//! Why fingerprint-scoped rather than revision-scoped: `state.json`'s `revision`
//! is global — any harness's key mutation bumps it — so keying on it invalidates
//! every harness's observation whenever one harness's key changes (which is
//! exactly what today's `gateway_model_probe` table does). The fingerprint makes
//! invalidation exactly as wide as the change.

use sha2::{Digest, Sha256};

use crate::domains::agents::route_auth::ProbeAuthMaterial;

/// Version prefix. Bumping it invalidates every entry on every machine on
/// purpose: a change to what the digest covers must not read as "unchanged".
const FINGERPRINT_VERSION: &str = "v1";

/// The digest phase A recorded a credential VALUE under.
///
/// Re-exported here rather than re-implemented, so the failure-detail redactor and
/// phase A can never drift into never matching — a silent failure that would leave
/// a quoted-back key in a persisted document with no test noticing.
pub fn digest_of(value: &str) -> String {
    crate::domains::agents::route_auth::probe_materialization::credential_value_digest(value)
}

/// `sha256:` + hex over the canonical serialization of the material.
///
/// Field order and separators are fixed here (never derived from a HashMap
/// iteration), so the same credential state always produces the same digest, and
/// reordering equivalent inputs never changes it.
pub fn fingerprint(material: &ProbeAuthMaterial) -> String {
    let mut hasher = Sha256::new();
    hasher.update(FINGERPRINT_VERSION.as_bytes());
    hasher.update(b"|");
    hasher.update(material.auth_context_id.as_bytes());
    hasher.update(b"|");
    // Already sorted by name in phase A; hashing digests, never values.
    for (name, digest) in &material.env_value_digests {
        hasher.update(name.as_bytes());
        hasher.update(b":");
        hasher.update(digest.as_bytes());
        hasher.update(b";");
    }
    hasher.update(b"|");
    hasher.update(
        material
            .gateway_base_url
            .as_deref()
            .unwrap_or_default()
            .as_bytes(),
    );
    hasher.update(b"|");
    for (path, mtime_nanos, len) in &material.discovery_stats {
        hasher.update(path.to_string_lossy().as_bytes());
        hasher.update(b":");
        hasher.update(mtime_nanos.to_string().as_bytes());
        hasher.update(b":");
        hasher.update(len.to_string().as_bytes());
        hasher.update(b";");
    }
    format!("sha256:{:x}", hasher.finalize())
}
