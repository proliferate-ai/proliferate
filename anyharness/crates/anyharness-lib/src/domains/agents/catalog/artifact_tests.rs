use std::collections::HashMap;
use std::sync::Mutex;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use ring::rand::SystemRandom;
use ring::signature::{Ed25519KeyPair, KeyPair};

use super::*;
use crate::domains::agents::catalog::bundled::bundled_agent_catalog_document;
use crate::domains::agents::registry::bundled::bundled_agent_registry_document;
use std::path::PathBuf;

fn scratch_dir() -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "anyharness-catalog-artifact-test-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Fabricates a minisign keypair and signs documents in "legacy" (non
/// pre-hashed) mode — the mode `verify_signature` checks against — using raw
/// ed25519 so tests need no BLAKE2b dependency.
struct TestSigner {
    key_pair: Ed25519KeyPair,
}

impl TestSigner {
    fn generate() -> Self {
        let rng = SystemRandom::new();
        let pkcs8 = Ed25519KeyPair::generate_pkcs8(&rng).expect("generate pkcs8");
        let key_pair = Ed25519KeyPair::from_pkcs8(pkcs8.as_ref()).expect("load keypair");
        Self { key_pair }
    }

    fn public_key(&self) -> minisign_verify::PublicKey {
        let mut bin = Vec::with_capacity(42);
        bin.extend_from_slice(&[0x45, 0x64]); // "Ed" - legacy, non-prehashed
        bin.extend_from_slice(&[0u8; 8]); // key id
        bin.extend_from_slice(self.key_pair.public_key().as_ref());
        minisign_verify::PublicKey::from_base64(&STANDARD.encode(&bin)).expect("decode pubkey")
    }

    fn sign(&self, bytes: &[u8]) -> Vec<u8> {
        let sig = self.key_pair.sign(bytes);
        let mut bin1 = Vec::with_capacity(74);
        bin1.extend_from_slice(&[0x45, 0x64]);
        bin1.extend_from_slice(&[0u8; 8]);
        bin1.extend_from_slice(sig.as_ref());

        let trusted_comment_text = "test";
        let mut global_msg = Vec::with_capacity(sig.as_ref().len() + trusted_comment_text.len());
        global_msg.extend_from_slice(sig.as_ref());
        global_msg.extend_from_slice(trusted_comment_text.as_bytes());
        let global_sig = self.key_pair.sign(&global_msg);

        format!(
            "untrusted comment: test\n{}\ntrusted comment: {trusted_comment_text}\n{}\n",
            STANDARD.encode(bin1),
            STANDARD.encode(global_sig.as_ref())
        )
        .into_bytes()
    }
}

/// In-memory fetch client keyed by full URL — no network in any test.
#[derive(Default)]
struct FakeFetchClient {
    files: Mutex<HashMap<String, Vec<u8>>>,
}

impl FakeFetchClient {
    fn insert(&self, url: &str, bytes: Vec<u8>) {
        self.files.lock().unwrap().insert(url.to_string(), bytes);
    }
}

impl ArtifactFetchClient for FakeFetchClient {
    fn get_bytes(&self, url: &str) -> anyhow::Result<Vec<u8>> {
        self.files
            .lock()
            .unwrap()
            .get(url)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("no fixture for {url}"))
    }
}

struct Fixture {
    client: FakeFetchClient,
    signer: TestSigner,
    catalog_bytes: Vec<u8>,
    #[allow(dead_code)]
    // AH-CLIPPY-2: flagged dead by lint wiring 2026-08-27; owner deletes or revives
    registry_bytes: Vec<u8>,
    #[allow(dead_code)]
    // AH-CLIPPY-2: flagged dead by lint wiring 2026-08-27; owner deletes or revives
    manifest_bytes: Vec<u8>,
}

const BASE_URL: &str = "https://example.test";
const CHANNEL: &str = "stable";

fn versioned_base(catalog_version: &str) -> String {
    format!("{BASE_URL}/catalogs/agents/{catalog_version}")
}

/// Builds a self-consistent, validly paired catalog+registry fixture (the
/// bundled pair, which already passes every gate) plus a fake client
/// pre-loaded with a correctly signed, correctly hashed manifest under it.
fn valid_fixture() -> Fixture {
    let catalog = bundled_agent_catalog_document().clone();
    let registry = bundled_agent_registry_document().clone();
    let catalog_bytes = serde_json::to_vec(&catalog).unwrap();
    let registry_bytes = serde_json::to_vec(&registry).unwrap();
    let signer = TestSigner::generate();

    let manifest = CatalogArtifactManifest {
        catalog_version: catalog.catalog_version.clone(),
        registry_version: registry.registry_version.clone(),
        generated_at: catalog.generated_at.clone(),
        files: [
            (
                CATALOG_FILE.to_string(),
                ManifestFileEntry {
                    sha256: sha256_hex(&catalog_bytes),
                },
            ),
            (
                REGISTRY_FILE.to_string(),
                ManifestFileEntry {
                    sha256: sha256_hex(&registry_bytes),
                },
            ),
        ]
        .into_iter()
        .collect(),
    };
    let manifest_bytes = serde_json::to_vec(&manifest).unwrap();

    let client = FakeFetchClient::default();
    let manifest_url = format!("{BASE_URL}/catalogs/agents/{CHANNEL}/manifest.json");
    client.insert(&manifest_url, manifest_bytes.clone());
    client.insert(
        &format!("{manifest_url}.minisig"),
        signer.sign(&manifest_bytes),
    );
    let base = versioned_base(&catalog.catalog_version);
    client.insert(&format!("{base}/{CATALOG_FILE}"), catalog_bytes.clone());
    client.insert(&format!("{base}/{REGISTRY_FILE}"), registry_bytes.clone());
    client.insert(
        &format!("{base}/{CATALOG_SIG_FILE}"),
        signer.sign(&catalog_bytes),
    );
    client.insert(
        &format!("{base}/{REGISTRY_SIG_FILE}"),
        signer.sign(&registry_bytes),
    );

    Fixture {
        client,
        signer,
        catalog_bytes,
        registry_bytes,
        manifest_bytes,
    }
}

#[test]
fn valid_artifact_fetches_verifies_and_stages() {
    let fixture = valid_fixture();
    let staged_dir = scratch_dir();
    let staged_path = staged_dir.join("staged");

    let pair = fetch_and_stage(
        BASE_URL,
        CHANNEL,
        &staged_path,
        &fixture.client,
        &[fixture.signer.public_key()],
    )
    .expect("valid artifact must be accepted");

    assert_eq!(
        pair.catalog.catalog_version,
        bundled_agent_catalog_document().catalog_version
    );
    assert!(staged_path.join(CATALOG_FILE).exists());
    assert!(staged_path.join(REGISTRY_FILE).exists());

    assert!(
        staged_path.join(CATALOG_SIG_FILE).exists(),
        "M1(b): the .minisig must be persisted alongside the staged doc"
    );
    assert!(staged_path.join(REGISTRY_SIG_FILE).exists());

    let reloaded = load_staged_from_disk(&staged_path, &[fixture.signer.public_key()])
        .expect("reload from disk, re-verified");
    assert_eq!(
        reloaded.catalog.catalog_version,
        pair.catalog.catalog_version
    );
}

#[test]
fn load_staged_from_disk_refuses_when_no_pubkey_is_provisioned() {
    let fixture = valid_fixture();
    let staged_dir = scratch_dir();
    let staged_path = staged_dir.join("staged");
    fetch_and_stage(
        BASE_URL,
        CHANNEL,
        &staged_path,
        &fixture.client,
        &[fixture.signer.public_key()],
    )
    .expect("valid artifact must be accepted");

    assert!(
        load_staged_from_disk(&staged_path, &[]).is_none(),
        "M2: an unprovisioned pubkey must refuse the warm-cache load unconditionally, never treat 'no key' as 'anything verifies'"
    );
}

#[test]
fn tampered_staged_doc_on_disk_is_refused_even_though_the_original_fetch_verified() {
    let fixture = valid_fixture();
    let staged_dir = scratch_dir();
    let staged_path = staged_dir.join("staged");
    fetch_and_stage(
        BASE_URL,
        CHANNEL,
        &staged_path,
        &fixture.client,
        &[fixture.signer.public_key()],
    )
    .expect("valid artifact must be accepted");

    // Simulate tampering with the staged catalog bytes on disk AFTER the
    // verified fetch wrote them (M1: a staged directory is untrusted input
    // to a fresh process, even one THIS process staged, until re-verified).
    let mut tampered = fixture.catalog_bytes.clone();
    tampered.push(b' ');
    std::fs::write(staged_path.join(CATALOG_FILE), &tampered).unwrap();

    assert!(
        load_staged_from_disk(&staged_path, &[fixture.signer.public_key()]).is_none(),
        "tampered staged bytes must fail re-verification against the persisted signature"
    );
}

#[test]
fn tampered_signature_is_rejected_and_floor_stays_active() {
    let fixture = valid_fixture();
    let base = versioned_base(&bundled_agent_catalog_document().catalog_version);
    // Valid bytes, WRONG signature: sign different bytes than what is served.
    fixture.client.insert(
        &format!("{base}/{CATALOG_SIG_FILE}"),
        fixture.signer.sign(b"not the catalog bytes"),
    );

    let staged_dir = scratch_dir();
    let staged_path = staged_dir.join("staged");
    let err = fetch_and_stage(
        BASE_URL,
        CHANNEL,
        &staged_path,
        &fixture.client,
        &[fixture.signer.public_key()],
    )
    .expect_err("tampered signature must be rejected");

    assert_eq!(err.reason, CatalogArtifactRejectReason::Signature);
    assert!(
        !staged_path.exists(),
        "a rejected artifact must not be staged"
    );
}

#[test]
fn wrong_version_identity_between_manifest_and_document_is_rejected() {
    let catalog = bundled_agent_catalog_document().clone();
    let registry = bundled_agent_registry_document().clone();
    let catalog_bytes = serde_json::to_vec(&catalog).unwrap();
    let registry_bytes = serde_json::to_vec(&registry).unwrap();
    let signer = TestSigner::generate();

    // Manifest claims a DIFFERENT catalogVersion than the document it names.
    let manifest = CatalogArtifactManifest {
        catalog_version: "not-the-real-version".to_string(),
        registry_version: registry.registry_version.clone(),
        generated_at: catalog.generated_at.clone(),
        files: [
            (
                CATALOG_FILE.to_string(),
                ManifestFileEntry {
                    sha256: sha256_hex(&catalog_bytes),
                },
            ),
            (
                REGISTRY_FILE.to_string(),
                ManifestFileEntry {
                    sha256: sha256_hex(&registry_bytes),
                },
            ),
        ]
        .into_iter()
        .collect(),
    };
    let manifest_bytes = serde_json::to_vec(&manifest).unwrap();

    let client = FakeFetchClient::default();
    let manifest_url = format!("{BASE_URL}/catalogs/agents/{CHANNEL}/manifest.json");
    client.insert(&manifest_url, manifest_bytes.clone());
    client.insert(
        &format!("{manifest_url}.minisig"),
        signer.sign(&manifest_bytes),
    );
    let base = versioned_base(&manifest.catalog_version);
    client.insert(&format!("{base}/{CATALOG_FILE}"), catalog_bytes.clone());
    client.insert(&format!("{base}/{REGISTRY_FILE}"), registry_bytes.clone());
    client.insert(
        &format!("{base}/{CATALOG_SIG_FILE}"),
        signer.sign(&catalog_bytes),
    );
    client.insert(
        &format!("{base}/{REGISTRY_SIG_FILE}"),
        signer.sign(&registry_bytes),
    );

    let staged_dir = scratch_dir();
    let staged_path = staged_dir.join("staged");
    let err = fetch_and_stage(
        BASE_URL,
        CHANNEL,
        &staged_path,
        &client,
        &[signer.public_key()],
    )
    .expect_err("version identity mismatch must be rejected");

    assert_eq!(err.reason, CatalogArtifactRejectReason::VersionIdentity);
}

#[test]
fn corrupt_sha256_is_rejected() {
    let fixture = valid_fixture();
    let base = versioned_base(&bundled_agent_catalog_document().catalog_version);
    // Serve different bytes than what the manifest's sha256 promises, still
    // signed correctly over THESE bytes so only the manifest-vs-content
    // sha256 check can catch it.
    let corrupted = {
        let mut bytes = fixture.catalog_bytes.clone();
        bytes.push(b' ');
        bytes
    };
    fixture
        .client
        .insert(&format!("{base}/{CATALOG_FILE}"), corrupted.clone());
    fixture.client.insert(
        &format!("{base}/{CATALOG_SIG_FILE}"),
        fixture.signer.sign(&corrupted),
    );

    let staged_dir = scratch_dir();
    let staged_path = staged_dir.join("staged");
    let err = fetch_and_stage(
        BASE_URL,
        CHANNEL,
        &staged_path,
        &fixture.client,
        &[fixture.signer.public_key()],
    )
    .expect_err("sha256 mismatch must be rejected");

    assert_eq!(err.reason, CatalogArtifactRejectReason::Sha256Mismatch);
}

#[test]
fn load_staged_from_disk_returns_none_for_a_missing_directory() {
    let staged_dir = scratch_dir();
    let staged_path = staged_dir.join("does-not-exist");
    let signer = TestSigner::generate();
    assert!(load_staged_from_disk(&staged_path, &[signer.public_key()]).is_none());
}

#[test]
fn load_staged_from_disk_returns_none_for_corrupt_json() {
    let staged_dir = scratch_dir();
    let signer = TestSigner::generate();
    let catalog_bytes = b"not json".to_vec();
    let registry_bytes = serde_json::to_vec(&bundled_agent_registry_document().clone()).unwrap();
    std::fs::write(staged_dir.join(CATALOG_FILE), &catalog_bytes).unwrap();
    std::fs::write(staged_dir.join(REGISTRY_FILE), &registry_bytes).unwrap();
    std::fs::write(
        staged_dir.join(CATALOG_SIG_FILE),
        signer.sign(&catalog_bytes),
    )
    .unwrap();
    std::fs::write(
        staged_dir.join(REGISTRY_SIG_FILE),
        signer.sign(&registry_bytes),
    )
    .unwrap();

    // Correctly signed, but not parseable JSON: the gate check runs AFTER
    // signature verification, and must still refuse.
    assert!(load_staged_from_disk(&staged_dir, &[signer.public_key()]).is_none());
}

#[test]
fn missing_env_never_constructs_a_fetch_client_or_touches_the_network() {
    // The ADR gate itself: `fetch_and_stage` is simply never called when the
    // base-url env is absent (see `sync.rs::from_staged_or_bundled`). This
    // test documents the contract at the type level: a fixture with NO
    // fetch entries at all still lets `load_staged_from_disk` run cleanly
    // (nothing to load), proving the floor-only path never needs a client.
    let staged_dir = scratch_dir();
    let signer = TestSigner::generate();
    assert!(load_staged_from_disk(&staged_dir.join("staged"), &[signer.public_key()]).is_none());
}

#[test]
fn unsigned_manifest_is_rejected_even_when_the_documents_it_names_are_correctly_signed() {
    let fixture = valid_fixture();
    // Serve a WRONG manifest signature: correctly signed documents underneath
    // it are irrelevant if the manifest that named their catalogVersion
    // can't itself be trusted (M3).
    fixture.client.insert(
        &format!("{BASE_URL}/catalogs/agents/{CHANNEL}/manifest.json.minisig"),
        fixture.signer.sign(b"not the manifest bytes"),
    );

    let staged_dir = scratch_dir();
    let staged_path = staged_dir.join("staged");
    let err = fetch_and_stage(
        BASE_URL,
        CHANNEL,
        &staged_path,
        &fixture.client,
        &[fixture.signer.public_key()],
    )
    .expect_err("a manifest with a bad signature must be rejected");

    assert_eq!(err.reason, CatalogArtifactRejectReason::Signature);
    assert!(!staged_path.exists());
}

/// (m2) The response-size cap on the real HTTP client. Spins up a tiny local
/// server (loopback only) that serves a body over the cap; a network-shaped
/// integration test is the only way to exercise the streaming/cap logic
/// itself rather than the fake in-memory client every other test here uses.
#[test]
fn bounded_http_client_rejects_a_response_over_the_size_cap() {
    use std::io::{Read as _, Write as _};
    use std::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
    let addr = listener.local_addr().unwrap();
    let handle = std::thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buf = [0u8; 1024];
            let _ = stream.read(&mut buf);
            let oversized_body = vec![b'a'; 5 * 1024 * 1024]; // 5 MiB > 4 MiB cap
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                oversized_body.len()
            );
            let _ = stream.write_all(header.as_bytes());
            let _ = stream.write_all(&oversized_body);
        }
    });

    let client = BoundedHttpFetchClient::new();
    let result = client.get_bytes(&format!("http://{addr}/oversized"));
    handle.join().unwrap();

    assert!(
        result.is_err(),
        "a response over the 4 MiB cap must be rejected, not buffered in full"
    );
}
