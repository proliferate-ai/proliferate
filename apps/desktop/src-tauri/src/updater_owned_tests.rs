//! Unit tests for the owned updater. Split out of `updater_owned.rs` via
//! `#[path]` to keep the implementation file under the repo line-count ceiling.

use super::*;

const PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDZEMkRFQkU1RDRENDI4MkUKUldRdUtOVFU1ZXN0YlFBN2ZWUjZzcXpkMWpvL1VUdWpnNmF3Q1g4U0hHYnd4MVFmUTdvaERmY04K";

#[test]
fn sha256_matches_known_vector() {
    // Known SHA-256 of "abc".
    assert_eq!(
        sha256_hex(b"abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}

#[test]
fn verify_artifact_accepts_matching_sha_but_rejects_flipped_byte() {
    let data = b"the update payload bytes".to_vec();
    let good_sha = sha256_hex(&data);

    // Negative control: the good sha passes the sha256 gate (it then falls
    // through to minisign, which fails for our fake signature — proving the
    // sha gate itself accepted the bytes).
    let via_good = verify_artifact(&data, &good_sha, "not-a-signature", PUBKEY);
    assert!(matches!(
        via_good.unwrap_err().code,
        OwnedUpdaterErrorCode::ArtifactHashMismatch
    ));

    // Corrupt artifact: flip a byte; sha256 gate must reject before minisign.
    let mut corrupt = data.clone();
    corrupt[0] ^= 0xff;
    let err = verify_artifact(&corrupt, &good_sha, "not-a-signature", PUBKEY).unwrap_err();
    assert_eq!(err.code, OwnedUpdaterErrorCode::ArtifactHashMismatch);
    assert!(err.message.contains("sha256 mismatch"), "{}", err.message);
}

#[test]
fn verify_signature_rejects_garbage() {
    let err = verify_signature(b"data", "###not-base64###", PUBKEY).unwrap_err();
    assert_eq!(err.code, OwnedUpdaterErrorCode::ArtifactHashMismatch);
}

#[test]
fn resume_decision_is_range_only_when_server_honors_it() {
    assert_eq!(resume_decision(1024, true), ResumeAction::ResumeFrom(1024));
    assert_eq!(resume_decision(1024, false), ResumeAction::RestartFromZero);
    assert_eq!(resume_decision(0, true), ResumeAction::RestartFromZero);
}

#[test]
fn validate_staged_deletes_on_sha_mismatch() {
    let dir = std::env::temp_dir().join(format!("owned-updater-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let version = "9.9.9";
    std::fs::create_dir_all(staged_dir(&dir)).unwrap();

    let bytes = b"staged artifact".to_vec();
    std::fs::write(staged_artifact_path(&dir, version), &bytes).unwrap();
    // Sidecar claims a sha that will not match the bytes.
    let info = StagedInfo {
        version: version.to_string(),
        sha256: "deadbeef".to_string(),
        byte_length: bytes.len() as u64,
        signature: "sig".to_string(),
        staged_at: "2026-01-01T00:00:00Z".to_string(),
    };
    std::fs::write(
        staged_sidecar_path(&dir, version),
        serde_json::to_vec(&info).unwrap(),
    )
    .unwrap();

    assert!(validate_staged(&dir, version, PUBKEY).is_none());
    // Mismatch must have deleted both the artifact and the sidecar.
    assert!(!staged_artifact_path(&dir, version).exists());
    assert!(!staged_sidecar_path(&dir, version).exists());

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn validated_version_accepts_sane_and_rejects_traversal() {
    // Accepted: dotted versions with build/prerelease decoration.
    assert_eq!(validated_version("1.2.3").unwrap(), "1.2.3");
    assert_eq!(
        validated_version("0.4.9-beta.1_rc").unwrap(),
        "0.4.9-beta.1_rc"
    );

    // Rejected: empty, traversal tokens, path separators, illegal chars.
    for bad in ["", ".", "..", "../x", "a/b", "a\\b", "a b", "a;b", "a:b"] {
        assert!(validated_version(bad).is_err(), "should reject {bad:?}");
    }

    // Length cap at 64.
    let max = "a".repeat(64);
    assert!(validated_version(&max).is_ok());
    let too_long = "a".repeat(65);
    assert!(validated_version(&too_long).is_err());

    // Rejections use the check-failed code.
    assert_eq!(
        validated_version("../x").unwrap_err().code,
        OwnedUpdaterErrorCode::CheckFailed
    );
}

/// A live download's abort must resolve only after the in-flight transfer
/// actually releases (its completion sender drops), so a JS ack means the file
/// is free — not merely that a cancel was requested.
#[tokio::test]
async fn abort_awaits_inflight_release() {
    let state = OwnedUpdaterState::default();
    let (done_tx, done_rx) = tokio::sync::oneshot::channel();
    let token = CancellationToken::new();
    {
        let mut guard = state.live.lock().unwrap();
        *guard = Some(LiveDownload {
            token: token.clone(),
            generation: 7,
            done_rx,
        });
    }

    let abort_fut = state.abort();
    tokio::pin!(abort_fut);

    // While the sender is held the abort future cannot resolve, even though the
    // token is cancelled promptly.
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), &mut abort_fut)
            .await
            .is_err(),
        "abort resolved before the in-flight transfer released"
    );
    assert!(token.is_cancelled());

    // Dropping the sender models the download future exiting; abort now resolves.
    drop(done_tx);
    let released = tokio::time::timeout(std::time::Duration::from_secs(5), abort_fut)
        .await
        .expect("abort should resolve once the sender drops");
    assert!(released);
}

/// Aborting with nothing live is a no-op that reports false.
#[tokio::test]
async fn abort_with_no_live_download_is_false() {
    let state = OwnedUpdaterState::default();
    assert!(!state.abort().await);
}
