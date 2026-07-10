//! Headless driver for T4-DESKTOP-1 (tier-4 desktop auto-update).
//!
//! Drives the REAL `tauri_plugin_updater` end to end against a local update
//! feed and a real N-1 `.app` bundle on disk:
//!
//!   1. `check()`  — fetch the served `latest.json`, semver-compare, and report
//!      the available version. Asserted to equal the expected N.
//!   2. `download_and_install()` — download the real N `.app.tar.gz`, **verify
//!      its minisign signature against the pubkey the N-1 build trusts** (this
//!      is where a broken/mismatched signing key surfaces), and swap the
//!      on-disk `.app` bundle in place.
//!
//! The bundle that gets swapped is chosen by `UpdaterBuilder::executable_path`
//! (a copy of the N-1 build the orchestrator hands us via `--install-app`), so
//! the install replaces that copy rather than this driver binary. The mock app
//! reports package version 0.1.0 (a `tauri::test` limitation — it is not the
//! real N-1 semver), but the running-version string is irrelevant to what this
//! asserts: the manifest fetch, the signature verification of the real N
//! artifact, and the real macOS bundle swap. The orchestrator reads the
//! swapped bundle's Info.plist `CFBundleShortVersionString` before/after to
//! prove N-1 -> N with real version strings (that plist value is exactly what
//! Tauri's `getVersion()` returns after a relaunch).
//!
//! Usage:
//!   t4-updater-driver \
//!     --feed http://127.0.0.1:8787/latest.json \
//!     --pubkey <base64 minisign pubkey the N-1 build trusts> \
//!     --install-app /path/to/staged-install/Proliferate.app \
//!     --expect-version 0.3.18

use std::path::PathBuf;
use std::process::ExitCode;

use tauri_plugin_updater::UpdaterExt;

struct Args {
    feed: String,
    pubkey: String,
    install_app: PathBuf,
    expect_version: String,
}

fn parse_args() -> Result<Args, String> {
    let mut feed = None;
    let mut pubkey = None;
    let mut install_app = None;
    let mut expect_version = None;
    let mut it = std::env::args().skip(1);
    while let Some(flag) = it.next() {
        let val = it
            .next()
            .ok_or_else(|| format!("flag {flag} requires a value"))?;
        match flag.as_str() {
            "--feed" => feed = Some(val),
            "--pubkey" => pubkey = Some(val),
            "--install-app" => install_app = Some(PathBuf::from(val)),
            "--expect-version" => expect_version = Some(val),
            other => return Err(format!("unknown flag: {other}")),
        }
    }
    Ok(Args {
        feed: feed.ok_or("--feed is required")?,
        pubkey: pubkey.ok_or("--pubkey is required")?,
        install_app: install_app.ok_or("--install-app is required")?,
        expect_version: expect_version.ok_or("--expect-version is required")?,
    })
}

// The macOS bundle-relative binary path: extract_path_from_executable walks up
// from a `.../Contents/MacOS/<bin>` path to the enclosing `.app`, so the
// updater's install target becomes the `.app` we point at here.
fn executable_path_for(app_bundle: &std::path::Path) -> PathBuf {
    app_bundle.join("Contents").join("MacOS").join("Proliferate")
}

#[tokio::main]
async fn main() -> ExitCode {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("t4-updater-driver: {e}");
            return ExitCode::FAILURE;
        }
    };

    if !args.install_app.exists() {
        eprintln!(
            "t4-updater-driver: --install-app does not exist: {}",
            args.install_app.display()
        );
        return ExitCode::FAILURE;
    }

    // A mock app carrying the updater plugin. The plugin config supplies
    // `dangerousInsecureTransportProtocol: true`, which the endpoint validator
    // requires for the http localhost feed (release builds reject non-https
    // otherwise; the shipped config never carries this flag).
    let mut ctx = tauri::test::mock_context(tauri::test::noop_assets());
    ctx.config_mut().plugins.0.insert(
        "updater".into(),
        serde_json::json!({
            "endpoints": [args.feed],
            "pubkey": args.pubkey,
            "dangerousInsecureTransportProtocol": true,
        }),
    );

    let app = match tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(ctx)
    {
        Ok(app) => app,
        Err(e) => {
            eprintln!("t4-updater-driver: failed to build mock app: {e}");
            return ExitCode::FAILURE;
        }
    };

    let endpoint = match args.feed.parse() {
        Ok(u) => u,
        Err(e) => {
            eprintln!("t4-updater-driver: bad --feed url: {e}");
            return ExitCode::FAILURE;
        }
    };

    let updater = match app
        .handle()
        .updater_builder()
        .endpoints(vec![endpoint])
        .and_then(|b| {
            Ok(b.pubkey(args.pubkey.clone())
                .target("darwin-aarch64")
                .executable_path(executable_path_for(&args.install_app))
                .build()?)
        }) {
        Ok(u) => u,
        Err(e) => {
            eprintln!("t4-updater-driver: failed to build updater: {e}");
            return ExitCode::FAILURE;
        }
    };

    // Step 1: check().
    let update = match updater.check().await {
        Ok(Some(u)) => u,
        Ok(None) => {
            eprintln!("t4-updater-driver: check() reported no update (feed did not advertise a newer version)");
            return ExitCode::FAILURE;
        }
        Err(e) => {
            eprintln!("t4-updater-driver: check() failed: {e}");
            return ExitCode::FAILURE;
        }
    };
    println!("check-ok available_version={}", update.version);
    if update.version != args.expect_version {
        eprintln!(
            "t4-updater-driver: expected available version {} but feed advertised {}",
            args.expect_version, update.version
        );
        return ExitCode::FAILURE;
    }

    // Step 2: download + verify signature + swap the bundle in place.
    match update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
    {
        Ok(()) => {
            println!(
                "install-ok bundle={} installed_version={}",
                args.install_app.display(),
                args.expect_version
            );
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("t4-updater-driver: download_and_install failed: {e}");
            ExitCode::FAILURE
        }
    }
}
