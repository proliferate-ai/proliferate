//! Unit tests for `installer::pinned` (fenced pin materialization). Split from
//! `pinned.rs` to stay under the 600-line source cap; `#[path]`-included from
//! there.

use super::*;
use crate::domains::agents::installer::install_policy::ResolvedPinCompanion;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn temp_dir(name: &str) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!("{name}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&path).expect("create temp dir");
    path
}

fn binary_pin(url: &str, sha256: &str) -> ResolvedPinSource {
    let platform = Platform::detect().expect("supported test platform");
    let mut targets = BTreeMap::new();
    targets.insert(
        platform.registry_key().to_string(),
        ResolvedPinTarget {
            url: url.to_string(),
            sha256: sha256.to_string(),
            download_size_bytes: None,
            expected_binary: None,
        },
    );
    ResolvedPinSource::Binary { targets }
}

#[test]
fn correct_sha_installs_the_pinned_binary() {
    let scratch = temp_dir("pinned-ok");
    let source_file = scratch.join("claude-payload");
    let bytes = b"#!/bin/sh\necho claude\n";
    std::fs::write(&source_file, bytes).expect("write payload");
    let url = format!("file://{}", source_file.display());

    let home = scratch.join("home");
    let result = install_binary_or_archive_from_pin(
        &binary_pin(&url, &sha256_hex(bytes)),
        "2.1.170",
        &AgentKind::Claude,
        &ArtifactRole::NativeCli,
        &home,
        None,
    )
    .expect("pinned install");

    assert_eq!(result.version.as_deref(), Some("2.1.170"));
    assert!(result.path.exists(), "installed binary should exist");
    assert_eq!(std::fs::read(&result.path).expect("read"), bytes);
    let _ = std::fs::remove_dir_all(&scratch);
}

#[test]
fn wrong_sha_is_refused_and_nothing_is_installed() {
    let scratch = temp_dir("pinned-bad");
    let source_file = scratch.join("claude-payload");
    std::fs::write(&source_file, b"tampered bytes").expect("write payload");
    let url = format!("file://{}", source_file.display());

    let home = scratch.join("home");
    let err = install_binary_or_archive_from_pin(
        &binary_pin(&url, &"0".repeat(64)),
        "2.1.170",
        &AgentKind::Claude,
        &ArtifactRole::NativeCli,
        &home,
        None,
    )
    .expect_err("checksum mismatch must fail");

    assert!(
        matches!(err, InstallError::ChecksumMismatch { .. }),
        "expected ChecksumMismatch, got {err:?}"
    );
    let target = managed_pinned_binary_path(&home, &AgentKind::Claude, &ArtifactRole::NativeCli);
    assert!(!target.exists(), "no artifact may survive a bad checksum");
    let _ = std::fs::remove_dir_all(&scratch);
}

#[test]
fn pinned_binary_install_lands_on_the_platform_executable_name() {
    // The Windows gap this guards: `claude` is a bare `Binary` pin whose
    // download URL is `.../win32-x64/claude.exe`, but the URL's filename is
    // never used for the destination. Before this fix the installer wrote
    // an extension-less `claude`, which Windows cannot execute, and the
    // failure only surfaced later as a misleading launch error.
    //
    // Asserting against `managed_pinned_binary_path` rather than a literal
    // is the point: it pins the write site to the one helper every read
    // site also calls, so the two can never drift apart again.
    let scratch = temp_dir("pinned-binary-name");
    let source_file = scratch.join("claude-payload");
    let bytes = b"#!/bin/sh\necho claude\n";
    std::fs::write(&source_file, bytes).expect("write payload");
    let url = format!("file://{}", source_file.display());

    let home = scratch.join("home");
    let result = install_binary_or_archive_from_pin(
        &binary_pin(&url, &sha256_hex(bytes)),
        "2.1.234",
        &AgentKind::Claude,
        &ArtifactRole::NativeCli,
        &home,
        None,
    )
    .expect("pinned install");

    assert_eq!(
        result.path,
        managed_pinned_binary_path(&home, &AgentKind::Claude, &ArtifactRole::NativeCli),
        "the installer must write exactly where resolution looks"
    );
    assert_eq!(
        result.path.file_name().and_then(|name| name.to_str()),
        Some(if cfg!(windows) {
            "claude.exe"
        } else {
            "claude"
        }),
        "windows needs the .exe suffix to execute the installed CLI"
    );
    assert!(result.path.exists(), "installed binary should exist");
    let _ = std::fs::remove_dir_all(&scratch);
}

#[test]
fn pinned_archive_install_renames_inner_binary_to_the_platform_name() {
    // The archive arm differs from the binary arm: its inner member
    // already carries a platform-specific name that includes the extension
    // on Windows (codex ships `codex-x86_64-pc-windows-msvc.exe` inside
    // `codex-<target>.exe.tar.gz`). Extraction renames that member onto the
    // managed target path, so the inner `.exe` is dropped unless the target
    // path supplies it. The destination name is derived from the agent
    // kind, never from the archive member.
    let scratch = temp_dir("pinned-archive-name");
    let payload = scratch.join("payload");
    std::fs::create_dir_all(&payload).expect("payload dir");
    let inner_name = "codex-x86_64-pc-windows-msvc.exe";
    std::fs::write(payload.join(inner_name), b"#!/bin/sh\necho codex\n").expect("inner");

    let archive = scratch.join("codex.tar.gz");
    let status = std::process::Command::new("tar")
        .arg("czf")
        .arg(&archive)
        .arg("-C")
        .arg(&payload)
        .arg(inner_name)
        .status()
        .expect("tar");
    assert!(status.success(), "tar must succeed");
    let sha = sha256_hex(&std::fs::read(&archive).expect("read archive"));

    let mut targets = BTreeMap::new();
    targets.insert(
        Platform::detect()
            .expect("platform")
            .registry_key()
            .to_string(),
        ResolvedPinTarget {
            url: format!("file://{}", archive.display()),
            sha256: sha,
            download_size_bytes: None,
            expected_binary: Some(inner_name.to_string()),
        },
    );

    let home = scratch.join("home");
    let result = install_binary_or_archive_from_pin(
        &ResolvedPinSource::Archive {
            targets,
            args: vec![],
            companions: vec![],
        },
        "0.147.0",
        &AgentKind::Codex,
        &ArtifactRole::NativeCli,
        &home,
        None,
    )
    .expect("pinned archive install");

    assert_eq!(
        result.path,
        managed_pinned_binary_path(&home, &AgentKind::Codex, &ArtifactRole::NativeCli),
        "the archive arm must land on the same path resolution reads"
    );
    assert_eq!(
        result.path.file_name().and_then(|name| name.to_str()),
        Some(if cfg!(windows) { "codex.exe" } else { "codex" }),
        "the inner member's own name must not leak into the destination"
    );
    assert!(result.path.exists(), "extracted binary should exist");
    let _ = std::fs::remove_dir_all(&scratch);
}

#[test]
fn pinned_archive_install_places_companions_beside_the_main_binary() {
    // codex ships `codex-code-mode-host` as its own release asset and expects
    // it on PATH next to `codex`; the launcher prepends the managed native
    // dir, so the companion must land there under its own platform name.
    let scratch = temp_dir("pinned-archive-companion");
    let payload = scratch.join("payload");
    std::fs::create_dir_all(&payload).expect("payload dir");

    let tar_member = |member: &str, archive_name: &str| {
        std::fs::write(payload.join(member), format!("#!/bin/sh\necho {member}\n"))
            .expect("member");
        let archive = scratch.join(archive_name);
        let status = std::process::Command::new("tar")
            .arg("czf")
            .arg(&archive)
            .arg("-C")
            .arg(&payload)
            .arg(member)
            .status()
            .expect("tar");
        assert!(status.success(), "tar must succeed");
        let sha = sha256_hex(&std::fs::read(&archive).expect("read archive"));
        ResolvedPinTarget {
            url: format!("file://{}", archive.display()),
            sha256: sha,
            download_size_bytes: None,
            expected_binary: Some(member.to_string()),
        }
    };
    let platform_key = Platform::detect()
        .expect("platform")
        .registry_key()
        .to_string();
    let mut targets = BTreeMap::new();
    targets.insert(
        platform_key.clone(),
        tar_member("codex-target", "codex.tar.gz"),
    );
    let mut companion_targets = BTreeMap::new();
    companion_targets.insert(
        platform_key,
        tar_member("codex-code-mode-host-target", "host.tar.gz"),
    );

    let home = scratch.join("home");
    let result = install_binary_or_archive_from_pin(
        &ResolvedPinSource::Archive {
            targets,
            args: vec![],
            companions: vec![ResolvedPinCompanion {
                name: "codex-code-mode-host".to_string(),
                targets: companion_targets,
            }],
        },
        "0.147.0",
        &AgentKind::Codex,
        &ArtifactRole::NativeCli,
        &home,
        None,
    )
    .expect("pinned archive install");

    let companion = companion_path(
        &home,
        &AgentKind::Codex,
        &ArtifactRole::NativeCli,
        "codex-code-mode-host",
    );
    assert_eq!(
        companion.parent(),
        result.path.parent(),
        "the companion must share the main binary's directory (the launcher PATH prefix)"
    );
    assert_eq!(
        companion.file_name().and_then(|name| name.to_str()),
        Some(if cfg!(windows) {
            "codex-code-mode-host.exe"
        } else {
            "codex-code-mode-host"
        }),
        "the companion is named for the host, not for the archive member"
    );
    assert!(
        crate::integrations::agent_cli::executable::is_valid_executable(&companion),
        "companion must be executable"
    );
    assert!(result.path.exists(), "main binary must still be installed");
    let _ = std::fs::remove_dir_all(&scratch);
}

#[test]
fn npm_adapter_pin_bakes_acp_launch_args() {
    // A registry-backed npm adapter must bake its ACP-mode
    // args (`--acp`) into the managed launcher — this is the bug an earlier
    // pass introduced by baking session default_args instead.
    let scratch = temp_dir("npm-adapter");
    let pkg = scratch.join("pkg");
    std::fs::create_dir_all(pkg.join("bin")).expect("bin dir");
    std::fs::write(
        pkg.join("package.json"),
        "{\"name\":\"fake-acp-agent\",\"version\":\"0.0.1\",\
         \"bin\":{\"fake-acp-agent\":\"bin/cli.js\"},\"files\":[\"bin\"]}",
    )
    .expect("package.json");
    std::fs::write(pkg.join("bin/cli.js"), "#!/usr/bin/env node\n").expect("cli");

    let home = scratch.join("home");
    let source = ResolvedPinSource::Npm {
        package: format!("file:{}", pkg.display()),
        sha256: None,
        args: vec!["--acp".to_string()],
    };
    let result = install_agent_process_from_pin(
        &source,
        Some("0.46.0"),
        &AgentKind::Grok,
        "fake-acp-agent",
        &home,
        true,
        None,
    )
    .expect("adapter install")
    .expect("installed launcher");

    let launcher = std::fs::read_to_string(&result.path).expect("read launcher");
    assert!(
        launcher.contains("--acp"),
        "ACP launch arg must be baked into the launcher: {launcher}"
    );
    let _ = std::fs::remove_dir_all(&scratch);
}

#[test]
fn archive_adapter_pin_preserves_sibling_files() {
    // Regression guard: a registry-backed adapter binary (cursor) execs its
    // sibling files, so the whole extracted tree must survive — not just the
    // entry binary.
    let scratch = temp_dir("archive-adapter");
    let payload = scratch.join("payload");
    std::fs::create_dir_all(payload.join("pkg")).expect("payload dirs");
    std::fs::write(
        payload.join("pkg/agent"),
        b"#!/bin/sh\nexec \"$(dirname \"$0\")/helper\"\n",
    )
    .expect("agent");
    std::fs::write(payload.join("pkg/helper"), b"#!/bin/sh\necho ok\n").expect("helper");

    let archive = scratch.join("bundle.tar.gz");
    let status = std::process::Command::new("tar")
        .arg("czf")
        .arg(&archive)
        .arg("-C")
        .arg(&payload)
        .arg("pkg")
        .status()
        .expect("tar");
    assert!(status.success(), "tar must succeed");
    let sha = sha256_hex(&std::fs::read(&archive).expect("read archive"));

    let mut targets = BTreeMap::new();
    targets.insert(
        Platform::detect()
            .expect("platform")
            .registry_key()
            .to_string(),
        ResolvedPinTarget {
            url: format!("file://{}", archive.display()),
            sha256: sha,
            download_size_bytes: None,
            expected_binary: Some("pkg/agent".to_string()),
        },
    );
    let source = ResolvedPinSource::Archive {
        targets,
        args: vec!["acp".to_string()],
        companions: vec![],
    };

    let home = scratch.join("home");
    let result = install_agent_process_from_pin(
        &source,
        Some("1.0.0"),
        &AgentKind::Cursor,
        "cursor-agent",
        &home,
        true,
        None,
    )
    .expect("adapter install")
    .expect("installed launcher");

    let storage = artifact_root(&home, &AgentKind::Cursor, &ArtifactRole::AgentProcess)
        .join("registry_binary");
    assert!(
        storage.join("pkg/agent").exists(),
        "entry binary must survive"
    );
    assert!(
        storage.join("pkg/helper").exists(),
        "sibling file must survive — the cursor regression this guards"
    );
    let launcher = std::fs::read_to_string(&result.path).expect("read launcher");
    assert!(
        launcher.contains("acp"),
        "ACP arg must be baked: {launcher}"
    );
    let _ = std::fs::remove_dir_all(&scratch);
}

#[cfg(unix)]
#[test]
fn staged_npm_swap_replaces_whole_tree_and_old_inode_survives() {
    // The managed npm/git adapter install must never touch the live tree:
    // it builds in a sibling staging dir and swaps whole. A running session
    // holding the old tree keeps its inode (POSIX) across the swap.
    use std::io::Read;

    let scratch = temp_dir("npm-staged-swap");
    let pkg = scratch.join("pkg");
    std::fs::create_dir_all(pkg.join("bin")).expect("bin dir");
    std::fs::write(
        pkg.join("package.json"),
        "{\"name\":\"fake-acp-agent\",\"version\":\"0.0.1\",\
         \"bin\":{\"fake-acp-agent\":\"bin/cli.js\"},\"files\":[\"bin\"]}",
    )
    .expect("package.json");
    std::fs::write(pkg.join("bin/cli.js"), "#!/usr/bin/env node\n").expect("cli");

    let home = scratch.join("home");
    let managed = artifact_root(&home, &AgentKind::Grok, &ArtifactRole::AgentProcess);
    std::fs::create_dir_all(&managed).expect("managed dir");
    // Pre-existing live tree with a sentinel a running session holds open.
    let sentinel = managed.join("OLD_TREE_SENTINEL");
    std::fs::write(&sentinel, b"old tree bytes").expect("sentinel");
    let mut held = std::fs::File::open(&sentinel).expect("hold sentinel fd");

    let source = ResolvedPinSource::Npm {
        package: format!("file:{}", pkg.display()),
        sha256: None,
        args: vec!["--acp".to_string()],
    };
    let result = install_agent_process_from_pin(
        &source,
        Some("0.1.0"),
        &AgentKind::Grok,
        "fake-acp-agent",
        &home,
        true,
        None,
    )
    .expect("adapter install")
    .expect("installed launcher");

    // New tree is live: exec + launcher present.
    assert!(
        managed.join("node_modules/.bin/fake-acp-agent").exists(),
        "new adapter exec must be live after swap"
    );
    assert!(result.path.exists(), "launcher present");
    // Whole-dir swap: the OLD sentinel is gone from the live tree (a merge
    // would have kept it).
    assert!(
        !sentinel.exists(),
        "whole-tree swap must replace, not merge, the live dir"
    );
    // The running session's held fd still reads the OLD bytes — the old
    // inode survived the swap (no kill, no wait).
    let mut old = String::new();
    held.read_to_string(&mut old).expect("read held fd");
    assert!(
        old.contains("old tree bytes"),
        "old inode content must survive the swap"
    );
    // No staging/previous residue after commit.
    let parent = managed.parent().expect("parent");
    assert!(
        !parent.join(".agent_process.staging").exists(),
        "no staging residue"
    );
    assert!(
        !parent.join(".agent_process.previous").exists(),
        "no previous-tree residue"
    );
    let _ = std::fs::remove_dir_all(&scratch);
}

#[test]
fn unusable_archive_adapter_restores_previous_tree() {
    let scratch = temp_dir("archive-adapter-rollback");
    let payload = scratch.join("payload");
    std::fs::create_dir_all(payload.join("pkg")).expect("payload dirs");
    std::fs::write(payload.join("pkg/helper"), b"replacement without entry")
        .expect("replacement helper");

    let archive = scratch.join("bundle.tar.gz");
    let status = std::process::Command::new("tar")
        .arg("czf")
        .arg(&archive)
        .arg("-C")
        .arg(&payload)
        .arg("pkg")
        .status()
        .expect("tar");
    assert!(status.success(), "tar must succeed");
    let sha = sha256_hex(&std::fs::read(&archive).expect("read archive"));

    let mut targets = BTreeMap::new();
    targets.insert(
        Platform::detect()
            .expect("platform")
            .registry_key()
            .to_string(),
        ResolvedPinTarget {
            url: format!("file://{}", archive.display()),
            sha256: sha,
            download_size_bytes: None,
            expected_binary: Some("pkg/agent".to_string()),
        },
    );
    let source = ResolvedPinSource::Archive {
        targets,
        args: vec!["acp".to_string()],
        companions: vec![],
    };

    let home = scratch.join("home");
    let storage = artifact_root(&home, &AgentKind::Cursor, &ArtifactRole::AgentProcess)
        .join("registry_binary");
    std::fs::create_dir_all(&storage).expect("previous tree");
    std::fs::write(storage.join("agent"), b"previous working adapter").expect("previous adapter");

    let error = install_agent_process_from_pin(
        &source,
        Some("2.0.0"),
        &AgentKind::Cursor,
        "cursor-agent",
        &home,
        true,
        None,
    )
    .expect_err("archive without its expected entry must fail");

    assert!(matches!(error, InstallError::MissingManagedArtifact(_)));
    assert_eq!(
        std::fs::read(storage.join("agent")).expect("restored adapter"),
        b"previous working adapter"
    );
    let _ = std::fs::remove_dir_all(&scratch);
}
