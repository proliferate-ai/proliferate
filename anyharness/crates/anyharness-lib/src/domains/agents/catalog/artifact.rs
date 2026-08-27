//! Publisher-lane boot fetch: a signed, versioned catalog+registry artifact
//! fetched ONCE at process boot, staged atomically, and gated through the
//! same validation the bundled floor runs. See `sync.rs`'s TRANSPORT LAW —
//! this module supplies the ONE decision point (`resolve_boot_source`) that
//! law is built around; nothing here runs again after boot.
//!
//! `ANYHARNESS_CATALOG_ARTIFACT_BASE_URL` absent => this entire module is
//! inert and the caller never constructs a client. That is the ADR gate, and
//! it is enforced at the call site (`sync.rs::from_staged_or_bundled`), not
//! here, so this module can be tested without env coupling.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::loader::parse_agent_catalog_json;
use super::schema::AgentCatalogDocument;
use super::validation_pairing::validate_agent_catalog_registry_pairing;
use crate::domains::agents::registry::schema::AgentRegistryDocument;
use crate::domains::agents::registry::validation::validate_agent_registry_document;

/// The rolling manifest published to `catalogs/agents/<channel>/manifest.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogArtifactManifest {
    pub catalog_version: String,
    pub registry_version: String,
    pub generated_at: String,
    pub files: std::collections::BTreeMap<String, ManifestFileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestFileEntry {
    pub sha256: String,
}

/// Why a fetched artifact was refused. Logged as `CATALOG_ARTIFACT_REJECTED`
/// with this as the typed `reason` field — never a free-text-only failure,
/// so an operator can alert/count on the reason without parsing prose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CatalogArtifactRejectReason {
    Fetch,
    Signature,
    Sha256Mismatch,
    Gates,
    VersionIdentity,
}

impl CatalogArtifactRejectReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Fetch => "fetch",
            Self::Signature => "signature",
            Self::Sha256Mismatch => "sha256_mismatch",
            Self::Gates => "gates",
            Self::VersionIdentity => "version_identity",
        }
    }
}

#[derive(Debug)]
pub struct CatalogArtifactRejected {
    pub reason: CatalogArtifactRejectReason,
    pub detail: String,
}

impl std::fmt::Display for CatalogArtifactRejected {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.reason.as_str(), self.detail)
    }
}

fn reject(reason: CatalogArtifactRejectReason, detail: impl Into<String>) -> CatalogArtifactRejected {
    let rejection = CatalogArtifactRejected {
        reason,
        detail: detail.into(),
    };
    tracing::warn!(
        reason = rejection.reason.as_str(),
        detail = %rejection.detail,
        "CATALOG_ARTIFACT_REJECTED"
    );
    rejection
}

/// Injected HTTP surface so boot-fetch tests never touch the network. The
/// real implementation enforces the 3s total bound itself.
pub trait ArtifactFetchClient: Send + Sync {
    fn get_bytes(&self, url: &str) -> anyhow::Result<Vec<u8>>;
}

/// Blocking reqwest fetch bounded to a hard 3s total timeout — the fetch
/// step is a best-effort boot nicety, never something worth blocking startup
/// over.
///
/// Stateless on purpose: `reqwest::blocking::Client` owns an internal tokio
/// runtime, and constructing or dropping one inside an async context panics
/// ("Cannot drop a runtime in a context where blocking is not allowed").
/// Boot wiring runs under the server runtime, so every call builds, uses,
/// and drops the blocking client on a dedicated OS thread instead. This is
/// a boot-only lane fetching a handful of sub-megabyte documents; per-call
/// client construction is noise.
pub struct BoundedHttpFetchClient;

impl BoundedHttpFetchClient {
    pub fn new() -> Self {
        Self
    }
}

impl Default for BoundedHttpFetchClient {
    fn default() -> Self {
        Self::new()
    }
}

/// (m2) Hard response-size ceiling. Every document this lane fetches
/// (catalog, registry, manifest, signatures) is well under a megabyte; 4 MiB
/// is generous headroom, not a working budget. Streamed with a `+1`-byte
/// cap so an over-cap response is detected deterministically rather than by
/// racing an unbounded read against memory pressure.
const MAX_RESPONSE_BYTES: u64 = 4 * 1024 * 1024;

impl ArtifactFetchClient for BoundedHttpFetchClient {
    fn get_bytes(&self, url: &str) -> anyhow::Result<Vec<u8>> {
        let url = url.to_string();
        std::thread::Builder::new()
            .name("catalog-artifact-fetch".into())
            .spawn(move || fetch_bytes_blocking(&url))
            .map_err(|e| anyhow::anyhow!("failed to spawn catalog fetch thread: {e}"))?
            .join()
            .map_err(|_| anyhow::anyhow!("catalog fetch thread panicked"))?
    }
}

/// Runs on the dedicated fetch thread — the only place a
/// `reqwest::blocking::Client` may live (see [`BoundedHttpFetchClient`]).
fn fetch_bytes_blocking(url: &str) -> anyhow::Result<Vec<u8>> {
    use std::io::Read;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(3))
        .connect_timeout(Duration::from_secs(3))
        .build()?;
    {
        let response = client.get(url).send()?.error_for_status()?;
        let mut limited = response.take(MAX_RESPONSE_BYTES + 1);
        let mut buf = Vec::new();
        limited.read_to_end(&mut buf)?;
        if buf.len() as u64 > MAX_RESPONSE_BYTES {
            anyhow::bail!(
                "response for {url} exceeded the {MAX_RESPONSE_BYTES}-byte cap; refusing rather \
                 than buffering an unbounded body"
            );
        }
        Ok(buf)
    }
}

/// A staged catalog+registry pair that passed every gate at fetch time.
/// Loaded fresh from disk at each boot (never re-verified again after this
/// module's one pass — the process holds it for its whole lifetime).
#[derive(Debug, Clone)]
pub struct StagedArtifactPair {
    pub catalog: AgentCatalogDocument,
    pub registry: AgentRegistryDocument,
    pub generated_at: chrono::DateTime<chrono::Utc>,
}

const CATALOG_FILE: &str = "catalog.json";
const REGISTRY_FILE: &str = "registry.json";
const CATALOG_SIG_FILE: &str = "catalog.json.minisig";
const REGISTRY_SIG_FILE: &str = "registry.json.minisig";
const MANIFEST_FILE: &str = "manifest.json";
const MANIFEST_SIG_FILE: &str = "manifest.json.minisig";
/// High-water mark file, persisted under `<runtime_home>/catalog/activated.json`.
/// Records the `generated_at` of the last artifact this process (or a prior
/// one) actually ACTIVATED, so a downgrade to an older-but-still-newer-than-
/// bundled staged artifact can never re-win after a newer one has already
/// been active on this machine (M3, downgrade resistance).
const ACTIVATED_MARK_FILE: &str = "activated.json";

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex_encode(&hasher.finalize())
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn parse_generated_at(raw: &str) -> anyhow::Result<chrono::DateTime<chrono::Utc>> {
    Ok(chrono::DateTime::parse_from_rfc3339(raw)?.with_timezone(&chrono::Utc))
}

/// Fetch the rolling manifest + both documents, verify sha256 against the
/// manifest, minisign-verify both documents against ANY key in `pubkeys`
/// (rotation choreography: current + next slot, tried in order), run the
/// SAME validation gates the bundled floor runs, verify version identity
/// between the manifest and the documents it names, and stage the pair
/// atomically under `staged_dir`. All-or-nothing: any failure leaves
/// `staged_dir` untouched (prior staged artifact, or nothing, survives).
pub fn fetch_and_stage(
    base_url: &str,
    channel: &str,
    staged_dir: &Path,
    client: &dyn ArtifactFetchClient,
    pubkeys: &[minisign_verify::PublicKey],
) -> Result<StagedArtifactPair, CatalogArtifactRejected> {
    let manifest_url = format!("{}/catalogs/agents/{}/manifest.json", base_url.trim_end_matches('/'), channel);
    let manifest_bytes = client
        .get_bytes(&manifest_url)
        .map_err(|e| reject(CatalogArtifactRejectReason::Fetch, e.to_string()))?;
    // M3 (downgrade resistance): the manifest itself is signed. Verify BEFORE
    // trusting anything it says — including `catalogVersion`, which the
    // versioned-file URLs below are built from. An attacker who can serve an
    // old, still-validly-signed catalog/registry pair but a forged manifest
    // pointing at it must not be able to walk this runtime backwards.
    let manifest_sig = client
        .get_bytes(&format!("{manifest_url}.minisig"))
        .map_err(|e| reject(CatalogArtifactRejectReason::Fetch, e.to_string()))?;
    verify_signature_any(pubkeys, &manifest_bytes, &manifest_sig)?;
    let manifest: CatalogArtifactManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|e| reject(CatalogArtifactRejectReason::Fetch, format!("manifest parse: {e}")))?;

    let versioned_base = format!(
        "{}/catalogs/agents/{}",
        base_url.trim_end_matches('/'),
        manifest.catalog_version
    );

    let catalog_bytes = fetch_verified_file(client, &versioned_base, CATALOG_FILE, &manifest)?;
    let registry_bytes = fetch_verified_file(client, &versioned_base, REGISTRY_FILE, &manifest)?;
    let catalog_sig = client
        .get_bytes(&format!("{versioned_base}/{CATALOG_SIG_FILE}"))
        .map_err(|e| reject(CatalogArtifactRejectReason::Fetch, e.to_string()))?;
    let registry_sig = client
        .get_bytes(&format!("{versioned_base}/{REGISTRY_SIG_FILE}"))
        .map_err(|e| reject(CatalogArtifactRejectReason::Fetch, e.to_string()))?;

    verify_signature_any(pubkeys, &catalog_bytes, &catalog_sig)?;
    verify_signature_any(pubkeys, &registry_bytes, &registry_sig)?;

    let catalog_json =
        std::str::from_utf8(&catalog_bytes).map_err(|e| reject(CatalogArtifactRejectReason::Gates, e.to_string()))?;
    let catalog = parse_agent_catalog_json(catalog_json)
        .map_err(|e| reject(CatalogArtifactRejectReason::Gates, e.to_string()))?;

    let registry: AgentRegistryDocument = serde_json::from_slice(&registry_bytes)
        .map_err(|e| reject(CatalogArtifactRejectReason::Gates, e.to_string()))?;
    validate_agent_registry_document(&registry)
        .map_err(|e| reject(CatalogArtifactRejectReason::Gates, e.to_string()))?;
    validate_agent_catalog_registry_pairing(&catalog, &registry)
        .map_err(|e| reject(CatalogArtifactRejectReason::Gates, e.to_string()))?;

    if catalog.catalog_version != manifest.catalog_version {
        return Err(reject(
            CatalogArtifactRejectReason::VersionIdentity,
            format!(
                "manifest catalogVersion '{}' != document catalogVersion '{}'",
                manifest.catalog_version, catalog.catalog_version
            ),
        ));
    }
    if registry.registry_version != manifest.registry_version {
        return Err(reject(
            CatalogArtifactRejectReason::VersionIdentity,
            format!(
                "manifest registryVersion '{}' != document registryVersion '{}'",
                manifest.registry_version, registry.registry_version
            ),
        ));
    }

    let generated_at = parse_generated_at(&catalog.generated_at)
        .map_err(|e| reject(CatalogArtifactRejectReason::Gates, format!("generated_at: {e}")))?;

    write_staged_atomic(
        staged_dir,
        &catalog_bytes,
        &registry_bytes,
        &manifest_bytes,
        &catalog_sig,
        &registry_sig,
        &manifest_sig,
    )
    .map_err(|e| reject(CatalogArtifactRejectReason::Fetch, format!("stage write: {e}")))?;

    Ok(StagedArtifactPair {
        catalog,
        registry,
        generated_at,
    })
}

fn fetch_verified_file(
    client: &dyn ArtifactFetchClient,
    versioned_base: &str,
    file: &str,
    manifest: &CatalogArtifactManifest,
) -> Result<Vec<u8>, CatalogArtifactRejected> {
    let entry = manifest
        .files
        .get(file)
        .ok_or_else(|| reject(CatalogArtifactRejectReason::Fetch, format!("manifest missing entry for {file}")))?;
    let bytes = client
        .get_bytes(&format!("{versioned_base}/{file}"))
        .map_err(|e| reject(CatalogArtifactRejectReason::Fetch, e.to_string()))?;
    let actual = sha256_hex(&bytes);
    if !actual.eq_ignore_ascii_case(&entry.sha256) {
        return Err(reject(
            CatalogArtifactRejectReason::Sha256Mismatch,
            format!("{file}: manifest sha256 '{}' != computed '{actual}'", entry.sha256),
        ));
    }
    Ok(bytes)
}

/// Tries every candidate key in order; succeeds if any one verifies. Empty
/// `pubkeys` always rejects — an unprovisioned signing key must never be
/// treated as "anything verifies."
fn verify_signature_any(
    pubkeys: &[minisign_verify::PublicKey],
    bytes: &[u8],
    signature: &[u8],
) -> Result<(), CatalogArtifactRejected> {
    if pubkeys.is_empty() {
        return Err(reject(
            CatalogArtifactRejectReason::Signature,
            "no signing pubkey provisioned",
        ));
    }
    let mut last_err = None;
    for pubkey in pubkeys {
        match verify_signature(pubkey, bytes, signature) {
            Ok(()) => return Ok(()),
            Err(e) => last_err = Some(e),
        }
    }
    Err(last_err.expect("pubkeys is non-empty"))
}

fn verify_signature(
    pubkey: &minisign_verify::PublicKey,
    bytes: &[u8],
    signature: &[u8],
) -> Result<(), CatalogArtifactRejected> {
    let signature_str = std::str::from_utf8(signature)
        .map_err(|e| reject(CatalogArtifactRejectReason::Signature, e.to_string()))?;
    let signature = minisign_verify::Signature::decode(signature_str)
        .map_err(|e| reject(CatalogArtifactRejectReason::Signature, e.to_string()))?;
    // Legacy (non-prehashed) mode: the documents here are small (well under
    // a megabyte), so minisign's streaming/prehash mode buys nothing and
    // this avoids pulling in a BLAKE2b dependency purely for parity with
    // large-file signing.
    pubkey
        .verify(bytes, &signature, true)
        .map_err(|e| reject(CatalogArtifactRejectReason::Signature, e.to_string()))
}

/// Sibling-staging-dir + rename, mirroring the installer's archive-tree
/// staging discipline (`installer::downloads::download_and_extract_archive_tree_verified`):
/// write the whole new tree next to the target, then atomically replace it.
#[allow(clippy::too_many_arguments)]
fn write_staged_atomic(
    staged_dir: &Path,
    catalog_bytes: &[u8],
    registry_bytes: &[u8],
    manifest_bytes: &[u8],
    catalog_sig: &[u8],
    registry_sig: &[u8],
    manifest_sig: &[u8],
) -> std::io::Result<()> {
    let parent = staged_dir.parent().unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(parent)?;
    let name = staged_dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("staged");
    let staging_dir: PathBuf = parent.join(format!(".{name}.staging"));
    let _ = std::fs::remove_dir_all(&staging_dir);
    std::fs::create_dir_all(&staging_dir)?;
    std::fs::write(staging_dir.join(CATALOG_FILE), catalog_bytes)?;
    std::fs::write(staging_dir.join(REGISTRY_FILE), registry_bytes)?;
    std::fs::write(staging_dir.join(MANIFEST_FILE), manifest_bytes)?;
    // M1(b): persist the .minisig files alongside the staged docs. Without
    // these on disk, a later boot's warm-cache load (`load_staged_from_disk`)
    // has no signature to re-verify against and MUST refuse — never trust
    // staged bytes it cannot itself re-verify.
    std::fs::write(staging_dir.join(CATALOG_SIG_FILE), catalog_sig)?;
    std::fs::write(staging_dir.join(REGISTRY_SIG_FILE), registry_sig)?;
    std::fs::write(staging_dir.join(MANIFEST_SIG_FILE), manifest_sig)?;
    let _ = std::fs::remove_dir_all(staged_dir);
    std::fs::rename(&staging_dir, staged_dir)?;
    Ok(())
}

/// `ANYHARNESS_CATALOG_ARTIFACT_BASE_URL` — the ADR gate. Absent means this
/// entire lane is inert: nothing downstream of this function is ever
/// consulted, and no `dyn ArtifactFetchClient` is ever constructed.
pub fn env_base_url() -> Option<String> {
    let raw = std::env::var("ANYHARNESS_CATALOG_ARTIFACT_BASE_URL")
        .ok()
        .filter(|v| !v.trim().is_empty())?;
    if is_acceptable_base_url_scheme(&raw) {
        Some(raw)
    } else {
        tracing::warn!(
            "ANYHARNESS_CATALOG_ARTIFACT_BASE_URL is set but is not an https:// URL; refusing \
             and treating the publisher lane as inert rather than fetching over a scheme that \
             cannot protect the manifest/signature exchange from a network attacker"
        );
        None
    }
}

/// (m1) Reject non-`https://` base URLs. `http://127.0.0.1` and
/// `http://localhost` are additionally accepted, but ONLY in test builds —
/// production boot never has a reason to fetch the publisher lane over
/// plaintext. Extracted as a pure function (no env access) so the scheme
/// policy itself is directly testable without mutating process env.
fn is_acceptable_base_url_scheme(url: &str) -> bool {
    if url.starts_with("https://") {
        return true;
    }
    #[cfg(test)]
    {
        if url.starts_with("http://127.0.0.1") || url.starts_with("http://localhost") {
            return true;
        }
    }
    false
}

/// `ANYHARNESS_CATALOG_CHANNEL`, default `"stable"`.
pub fn env_channel() -> String {
    std::env::var("ANYHARNESS_CATALOG_CHANNEL")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "stable".to_string())
}

/// The publisher lane's signing pubkey, base64 minisign-encoded. This is a
/// SEPARATE trust domain from desktop app signing (`AGENT_CATALOG_SIGNING_*`
/// CI secrets, never the Tauri updater key). The placeholder below has not
/// been provisioned yet (see PR founder question #3); until an operator
/// replaces it with the real published key, [`baked_pubkey`] returns `None`
/// and the fetch step never runs, even with the base-url env set — the lane
/// stays inert by construction, not by luck.
const CATALOG_SIGNING_PUBKEY_B64: &str = "UNPROVISIONED";

/// Second slot for the two-release rotation choreography (ship pubkey N+1
/// alongside N in one release, drop N the release after). Unset until a
/// rotation is in flight.
const CATALOG_SIGNING_PUBKEY_B64_NEXT: Option<&str> = None;

/// Resolves the active signing pubkey(s). Returns the primary key only when
/// it decodes; during a rotation window a caller may also consult the NEXT
/// slot. Kept deliberately permissive (`None` rather than panic) because an
/// unprovisioned or malformed pubkey must degrade to "lane inert", never to
/// a boot crash.
pub fn baked_pubkey() -> Option<minisign_verify::PublicKey> {
    minisign_verify::PublicKey::from_base64(CATALOG_SIGNING_PUBKEY_B64).ok()
}

/// The rotation-slot key, when provisioned and valid.
pub fn baked_pubkey_next() -> Option<minisign_verify::PublicKey> {
    CATALOG_SIGNING_PUBKEY_B64_NEXT.and_then(|b64| minisign_verify::PublicKey::from_base64(b64).ok())
}

/// Load a previously staged artifact from disk (no network) — the "warm
/// cache" path used when this boot's fetch failed or was skipped but a prior
/// boot staged something. This is untrusted input to THIS process until
/// re-verified: M1 requires the FULL minisign verification the fetch path
/// ran, against the exact staged bytes, with the same baked pubkeys, before
/// any schema/generated_at gate runs. If `pubkeys` is empty (unprovisioned),
/// this refuses unconditionally — an unprovisioned signing key must never be
/// treated as "anything on disk verifies" (M2: this is also the lane-inert
/// gate for the warm-cache path; the caller in `sync.rs` additionally never
/// even calls this function when the env var is absent).
///
/// A corrupted, partially written, or unsigned staged dir must fall back to
/// the floor, never crash boot — so this never propagates an error, only
/// `None`.
pub fn load_staged_from_disk(
    staged_dir: &Path,
    pubkeys: &[minisign_verify::PublicKey],
) -> Option<StagedArtifactPair> {
    if pubkeys.is_empty() {
        return None;
    }

    let catalog_bytes = std::fs::read(staged_dir.join(CATALOG_FILE)).ok()?;
    let registry_bytes = std::fs::read(staged_dir.join(REGISTRY_FILE)).ok()?;
    let catalog_sig = std::fs::read(staged_dir.join(CATALOG_SIG_FILE)).ok()?;
    let registry_sig = std::fs::read(staged_dir.join(REGISTRY_SIG_FILE)).ok()?;

    if let Err(e) = verify_signature_any(pubkeys, &catalog_bytes, &catalog_sig) {
        tracing::warn!(reason = e.reason.as_str(), "staged catalog failed minisign re-verification on load");
        return None;
    }
    if let Err(e) = verify_signature_any(pubkeys, &registry_bytes, &registry_sig) {
        tracing::warn!(reason = e.reason.as_str(), "staged registry failed minisign re-verification on load");
        return None;
    }

    let catalog_json = std::str::from_utf8(&catalog_bytes).ok()?;
    let catalog = match parse_agent_catalog_json(catalog_json) {
        Ok(c) => c,
        Err(e) => {
            reject(CatalogArtifactRejectReason::Gates, format!("staged catalog: {e}"));
            return None;
        }
    };
    let registry: AgentRegistryDocument = match serde_json::from_slice(&registry_bytes) {
        Ok(r) => r,
        Err(e) => {
            reject(CatalogArtifactRejectReason::Gates, format!("staged registry parse: {e}"));
            return None;
        }
    };
    if let Err(e) = validate_agent_registry_document(&registry) {
        reject(CatalogArtifactRejectReason::Gates, format!("staged registry: {e}"));
        return None;
    }
    if let Err(e) = validate_agent_catalog_registry_pairing(&catalog, &registry) {
        reject(CatalogArtifactRejectReason::Gates, format!("staged pairing: {e}"));
        return None;
    }
    let generated_at = match parse_generated_at(&catalog.generated_at) {
        Ok(g) => g,
        Err(e) => {
            reject(CatalogArtifactRejectReason::Gates, format!("staged generated_at: {e}"));
            return None;
        }
    };
    Some(StagedArtifactPair {
        catalog,
        registry,
        generated_at,
    })
}

/// (M3) Persisted monotonic high-water mark: the `generated_at` of the last
/// artifact this machine ever ACTIVATED, across process restarts. Required
/// in addition to the bundled-floor comparison because the floor never
/// moves (it is compiled into the binary), so without this mark a runtime
/// could be pointed at an OLDER — but still validly signed and still newer
/// than the floor — staged artifact and "roll back" a previously-activated
/// newer one. Tolerant by design: absent or garbage falls back to the
/// bundled-floor-only comparison, never a boot failure.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ActivatedMark {
    generated_at: String,
}

fn activated_mark_path(runtime_home: &Path) -> PathBuf {
    runtime_home.join("catalog").join(ACTIVATED_MARK_FILE)
}

/// Tolerant read: a missing file, unreadable file, or unparseable/unparseable
/// timestamp all resolve to `None` — never an error, never a panic.
pub fn read_high_water_mark(runtime_home: &Path) -> Option<chrono::DateTime<chrono::Utc>> {
    let raw = std::fs::read_to_string(activated_mark_path(runtime_home)).ok()?;
    let mark: ActivatedMark = serde_json::from_str(&raw).ok()?;
    parse_generated_at(&mark.generated_at).ok()
}

/// Write the mark ONLY after a successful activation decision (i.e. only
/// when the staged pair actually won and became the active catalog for this
/// process). Best-effort: a write failure is logged, never propagated —
/// losing the mark degrades to "bundled-floor-only" comparison next boot,
/// which is the same safe default a fresh machine starts from, never a
/// crash or an unverified activation.
pub fn write_high_water_mark(runtime_home: &Path, generated_at: chrono::DateTime<chrono::Utc>) {
    let path = activated_mark_path(runtime_home);
    let mark = ActivatedMark {
        generated_at: generated_at.to_rfc3339(),
    };
    let result = (|| -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string(&mark)
            .map_err(|e| std::io::Error::other(e))?;
        std::fs::write(path, json)
    })();
    if let Err(e) = result {
        tracing::warn!(error = %e, "failed to persist the catalog activation high-water mark; a future boot may re-evaluate against the bundled floor only");
    }
}

#[cfg(test)]
#[path = "artifact_tests.rs"]
mod tests;
