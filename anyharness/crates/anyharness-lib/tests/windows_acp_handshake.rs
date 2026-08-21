//! Does a managed agent launched through the Windows `.cmd` launcher actually
//! SPEAK ACP?
//!
//! `tests/windows_managed_agent_install.rs` proved the layer under this one:
//! the pinned installer downloads and sha256-verifies `claude.exe`, runs a real
//! `npm install`, emits `claude-launcher.cmd`, and `CreateProcess` can spawn
//! it. It proved that by spawning the launcher, immediately closing stdin, and
//! observing exit 0.
//!
//! Exit 0 with empty stdout AND empty stderr is a much weaker statement than it
//! looks. Nothing was ever written to the launcher's stdin and nothing was ever
//! read back, so the only thing established was "the process starts and exits
//! cleanly on EOF". A `.cmd` file containing nothing but `@echo off` would pass
//! that test. Every layer above spawn — whether the batch wrapper forwards the
//! stdio handles to its grandchild node process, whether cmd.exe injects
//! anything into the stream, whether newline-delimited JSON survives a Windows
//! pipe intact in both directions — was untested.
//!
//! This test closes that gap. It drives a real ACP `initialize` request over
//! stdio into the launcher the real installer emitted, and requires a
//! well-formed JSON-RPC response back:
//!
//!   bundled catalog -> `install_agent_with_pins` -> emitted `.cmd` launcher
//!   -> spawn -> write `initialize` -> read + validate the response
//!   -> write a second `initialize` -> read it -> close stdin -> clean exit
//!
//! ## Why claude
//!
//! `claude` is the only agent that can answer this question today.
//! `cursor` and `opencode` declare no `windows_*` pins at all and fail
//! `NoPinForPlatform` before anything is installed. `codex` has Windows pins
//! but reaches them through a `.tar.gz` extraction branch nothing has ever
//! executed on Windows, so a red result there would be ambiguous between the
//! extraction branch and the handshake. `grok` installs and spawns on Windows
//! (proved in run 32450488248) but its ACP surface is a different adapter, and
//! it is not the default agent. `claude` is the default agent, has proven
//! Windows pins (#2149), a proven Windows install and spawn (#2152 +
//! run 32450488248), and is the one that has to work for a Windows beta.
//!
//! ## Why no credential is needed, and how that was checked
//!
//! `initialize` is the handshake that PRECEDES authentication: the runtime's
//! own `initialize_connection` sends it first and only then inspects
//! `auth_methods` to decide whether to call `authenticate`
//! (`live/sessions/driver/session_lifecycle.rs`). That is the client side.
//! The agent side was checked too, by reading the pinned adapter at the exact
//! sha the catalog installs (`claude-agent-acp`
//! @ 65f6205329daea4a521ee0f0c042722b0feb306a): `ClaudeAcpAgent.initialize`
//! reads `request.clientCapabilities` and a handful of `process.env` remote
//! hints, then returns a literal response object. It reads no credential file,
//! makes no network call, and cannot fail for lack of auth. `src/index.ts`'s
//! startup path is likewise credential-free.
//!
//! No API key is used, needed, or accepted by this test.
//!
//! ## Why an integration test target
//!
//! `anyharness-lib`'s `--lib` test target does not build for Windows (ten
//! pre-existing test-only POSIX assumptions in unrelated modules). An
//! integration test compiles as its own crate against the public surface and
//! never pulls those in. Same reason, same shape as
//! `tests/windows_managed_agent_install.rs` and `tests/windows_process_tree.rs`.
//!
//! The deadline-bounded stdio peer these tests drive lives in
//! `tests/acp_stdio/mod.rs`.
//!
//! ## Anti-skip and anti-hang
//!
//! There is no skip path. A missing agent, a failed install, an empty
//! response, a malformed response, a JSON-RPC error response, an early EOF and
//! a silent process are each a distinct, loud panic. Every read is bounded by
//! a deadline and a timeout is `ACP-HANDSHAKE-TIMEOUT`, never a pass.
//!
//! The timeout and EOF discriminators are not taken on faith either:
//! `the_handshake_timeout_is_a_loud_failure_not_a_pass` and
//! `an_immediate_exit_is_a_loud_failure_not_a_pass` run the same reader
//! against a process that never answers and a process that answers nothing and
//! exits, on every run, on both operating systems.
//!
//! Setting `ACP_HANDSHAKE_NEGATIVE_CONTROL=1` sabotages the real path end to
//! end: after the real install, the npm bin shim the emitted launcher invokes
//! is replaced with a program that starts, holds stdin, and never writes. The
//! launcher, the spawn and the assertions are untouched, so the run must go red
//! with `ACP-HANDSHAKE-TIMEOUT`. It can only ever turn a pass into a failure.

mod acp_stdio;

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use agent_client_protocol as acp;
use anyharness_lib::domains::agents::catalog::service::AgentCatalogService;
use anyharness_lib::domains::agents::catalog::sync::CatalogSyncService;
use anyharness_lib::domains::agents::installer::{install_agent_with_pins, InstallOptions};
use anyharness_lib::domains::agents::model::ArtifactRole;
use anyharness_lib::domains::agents::registry;

use acp_stdio::{spawn_node, AcpPeer, HandshakeFailure};

/// Deliberately not 0 or 1. The agent may issue its own client-bound requests
/// on the same stream, and its id space is independent of ours; a distinctive
/// id plus the "responses have no `method` member" check below means a
/// collision cannot be mistaken for our answer.
const FIRST_REQUEST_ID: u64 = 4242;
const SECOND_REQUEST_ID: u64 = 4243;

/// Generous, because the runner is slow and the install that precedes this took
/// about seven minutes on windows-latest in run 32450488248. Generous is fine;
/// unbounded is not. Node cold start plus the adapter's SDK import is the thing
/// being waited on.
const FIRST_RESPONSE_TIMEOUT: Duration = Duration::from_secs(180);
/// The process is warm by now. If the stream survived one round trip and dies
/// on the second, that is a framing bug, and it should be reported in a minute,
/// not in three.
const SECOND_RESPONSE_TIMEOUT: Duration = Duration::from_secs(60);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(60);
/// The in-suite discriminators talk to a process that is known never to answer,
/// so there is nothing to wait for.
const DISCRIMINATOR_TIMEOUT: Duration = Duration::from_secs(15);

const NEGATIVE_CONTROL_ENV: &str = "ACP_HANDSHAKE_NEGATIVE_CONTROL";

// ---------------------------------------------------------------------------
// The real thing.
// ---------------------------------------------------------------------------

#[test]
fn the_managed_claude_launcher_answers_a_real_acp_initialize_handshake() {
    let negative_control = negative_control_requested();
    if negative_control {
        println!(
            "!!! NEGATIVE CONTROL ENGAGED ({NEGATIVE_CONTROL_ENV}=1): the npm bin shim the \
             emitted launcher invokes will be replaced with a process that starts, holds stdin \
             and never answers. This run MUST fail with ACP-HANDSHAKE-TIMEOUT."
        );
    }

    let runtime_home = scratch_runtime_home("handshake");
    println!("runtime_home = {}", runtime_home.display());

    // Real bundled catalog + real bundled registry: the two documents the
    // shipped runtime boots with. No fixture, no override.
    let catalog = AgentCatalogService::new(Arc::new(CatalogSyncService::from_bundled()));
    let pins = catalog
        .pin_overrides("claude")
        .expect("claude must have catalog pins; without them there is nothing to install");
    println!("catalog pins = {pins:?}");
    let descriptor =
        registry::descriptor("claude").expect("claude must have a registry descriptor");
    println!(
        "descriptor.launch.executable_name = {}",
        descriptor.launch.executable_name
    );

    let options = InstallOptions {
        reinstall: true,
        ..InstallOptions::default()
    };
    let installed = install_agent_with_pins(&descriptor, &runtime_home, &options, Some(&pins))
        .unwrap_or_else(|error| {
            panic!(
                "install_agent_with_pins failed for claude: {error} (kind {:?}). The handshake \
                 was never reached; this is an install failure, not a handshake result.",
                error.kind()
            )
        });
    for artifact in &installed {
        println!(
            "installed role={:?} source={} version={:?} path={}",
            artifact.role,
            artifact.source,
            artifact.version,
            artifact.path.display()
        );
    }

    let launcher = installed
        .iter()
        .find(|artifact| matches!(artifact.role, ArtifactRole::AgentProcess))
        .map(|artifact| artifact.path.clone())
        .expect("the install must report an agent-process artifact; there is nothing to spawn");
    assert!(
        launcher.is_file(),
        "the installer reported a launcher at {} but no such file exists",
        launcher.display()
    );
    match std::fs::read_to_string(&launcher) {
        Ok(script) => println!("--- launcher script ({})\n{script}", launcher.display()),
        Err(error) => println!("--- launcher is not UTF-8 text: {error}"),
    }

    let managed_dir = runtime_home
        .join("agents")
        .join("claude")
        .join("agent_process");
    if negative_control {
        sabotage_npm_bin_shim(&managed_dir, "claude-agent-acp");
    }

    // Spawned exactly the way `live::sessions::driver::process` spawns a
    // managed agent: the launcher path as the program, no extra args (the
    // launcher already bakes the catalog's ACP args), all three handles piped.
    let mut command = Command::new(&launcher);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .current_dir(&runtime_home);
    let child = command.spawn().unwrap_or_else(|error| {
        panic!(
            "spawning the managed launcher {} failed: {error} (kind {:?}, raw os error {:?})",
            launcher.display(),
            error.kind(),
            error.raw_os_error()
        )
    });
    println!("spawned pid {}", child.id());
    let mut peer = AcpPeer::attach(child);

    // ---- Round trip 1: the handshake itself. --------------------------------
    let first_outcome = peer.request(
        FIRST_REQUEST_ID,
        "initialize",
        initialize_params(),
        FIRST_RESPONSE_TIMEOUT,
    );
    let first = match first_outcome {
        Ok(value) => value,
        Err(failure) => {
            peer.kill();
            let _ = std::fs::remove_dir_all(&runtime_home);
            panic!("{failure}");
        }
    };
    assert_well_formed_initialize_response(&first, FIRST_REQUEST_ID);

    // ---- Round trip 2: the stream is still framed. --------------------------
    // One answered request could in principle be a single flush that happened
    // to land. A second answered request on the same pipe rules that out and
    // proves ndjson framing holds across messages through the `.cmd` wrapper.
    let second_outcome = peer.request(
        SECOND_REQUEST_ID,
        "initialize",
        initialize_params(),
        SECOND_RESPONSE_TIMEOUT,
    );
    let second = match second_outcome {
        Ok(value) => value,
        Err(failure) => {
            peer.kill();
            let _ = std::fs::remove_dir_all(&runtime_home);
            panic!("the FIRST handshake succeeded but the second request on the same stream did not: {failure}");
        }
    };
    assert_well_formed_initialize_response(&second, SECOND_REQUEST_ID);

    // ---- Shutdown: still clean after real traffic. --------------------------
    let (status, stderr) = peer.close_stdin_and_wait(SHUTDOWN_TIMEOUT);
    println!("--- agent stderr (full)\n{stderr}");
    println!("--- exit status after stdin close: {status:?}");
    let _ = std::fs::remove_dir_all(&runtime_home);

    let status = status.unwrap_or_else(|| {
        panic!(
            "the managed agent answered the handshake but did not exit within {SHUTDOWN_TIMEOUT:?} \
             of stdin EOF; it was killed. stderr:\n{stderr}"
        )
    });
    assert!(
        status.success(),
        "the managed agent answered the handshake but exited unsuccessfully: {status:?}\nstderr:\n{stderr}"
    );

    assert!(
        !negative_control,
        "NEGATIVE CONTROL DID NOT DISCRIMINATE: {NEGATIVE_CONTROL_ENV}=1 replaced the launcher's \
         target with a process that never answers, and the handshake still passed. Either the \
         sabotage did not take effect or the assertions above do not depend on a real response."
    );
}

/// The exact `initialize` payload the runtime sends, built from the real
/// `acp::schema` types rather than a hand-written object, so a schema change
/// that would break production breaks this too.
///
/// The client capabilities mirror
/// `live::sessions::driver::session_lifecycle::build_client_capabilities` for
/// `claude` (that function is `pub(in crate::live::sessions)` and unreachable
/// from an integration test). Notably it advertises no terminal-auth
/// capability, so the adapter has no auth method to offer back and
/// `authMethods` comes back empty — which is itself the evidence that
/// `initialize` completes with no credential in play.
fn initialize_params() -> serde_json::Value {
    let claude_meta = serde_json::Map::from_iter([(
        "claude".to_string(),
        serde_json::Value::Object(serde_json::Map::from_iter([(
            "mcpElicitation".to_string(),
            serde_json::Value::Bool(true),
        )])),
    )]);
    let capabilities =
        acp::schema::ClientCapabilities::new().meta(acp::schema::Meta::from_iter(claude_meta));
    let request = acp::schema::InitializeRequest::new(acp::schema::ProtocolVersion::V1)
        .client_info(acp::schema::Implementation::new("anyharness", "0.1.0"))
        .client_capabilities(capabilities);
    serde_json::to_value(request).expect("InitializeRequest must serialize")
}

/// Every way this response could be hollow is a named failure.
fn assert_well_formed_initialize_response(response: &serde_json::Value, expected_id: u64) {
    assert_eq!(
        response.get("jsonrpc").and_then(serde_json::Value::as_str),
        Some("2.0"),
        "response is not JSON-RPC 2.0: {response}"
    );
    assert_eq!(
        response.get("id").and_then(serde_json::Value::as_u64),
        Some(expected_id),
        "response id does not match the request: {response}"
    );
    assert!(
        response.get("error").is_none(),
        "ACP-HANDSHAKE-ERROR-RESPONSE: the agent answered `initialize` with a JSON-RPC error \
         rather than a result. If this is an auth error then the premise that `initialize` is \
         credential-free is wrong and must be reported as such. Full response: {response}"
    );
    let result = response
        .get("result")
        .unwrap_or_else(|| panic!("response has neither `error` nor `result`: {response}"));
    assert!(
        result.is_object() && !result.as_object().expect("object").is_empty(),
        "ACP-HANDSHAKE-EMPTY-RESULT: `initialize` returned an empty result. An empty response is \
         a failure, not a pass. Full response: {response}"
    );

    // Raw-JSON assertions first, because the typed model below is deliberately
    // lenient: `InitializeResponse` deserializes `agentInfo` and `authMethods`
    // with `DefaultOnError`, so a typed round trip alone would silently accept
    // a response with a garbage `agentInfo`.
    assert_eq!(
        result
            .get("protocolVersion")
            .and_then(serde_json::Value::as_u64),
        Some(1),
        "the agent did not negotiate ACP protocol version 1: {result}"
    );
    let agent_name = result
        .get("agentInfo")
        .and_then(|info| info.get("name"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or_else(|| panic!("`result.agentInfo.name` is missing or not a string: {result}"));
    assert!(
        !agent_name.trim().is_empty(),
        "`result.agentInfo.name` is blank: {result}"
    );
    let capabilities = result
        .get("agentCapabilities")
        .unwrap_or_else(|| panic!("`result.agentCapabilities` is missing: {result}"));
    assert!(
        capabilities.is_object(),
        "`result.agentCapabilities` is not an object: {result}"
    );
    assert!(
        result
            .get("authMethods")
            .map(serde_json::Value::is_array)
            .unwrap_or(false),
        "`result.authMethods` is missing or not an array: {result}"
    );

    // And now the same bytes through the type the runtime actually decodes
    // into. If this fails, production would have failed on the same response.
    let typed: acp::schema::InitializeResponse = serde_json::from_value(result.clone())
        .unwrap_or_else(|error| {
            panic!(
                "the response does not deserialize into the runtime's own \
                 `acp::schema::InitializeResponse`: {error}. Full result: {result}"
            )
        });
    assert_eq!(
        typed.protocol_version,
        acp::schema::ProtocolVersion::V1,
        "typed protocol version mismatch: {result}"
    );
    let typed_info = typed
        .agent_info
        .unwrap_or_else(|| panic!("typed `agent_info` decoded to None: {result}"));
    println!(
        "handshake OK: agent {:?} version {:?}, {} auth method(s) advertised",
        typed_info.name,
        typed_info.version,
        typed.auth_methods.len()
    );
}

// ---------------------------------------------------------------------------
// In-suite discriminators. These run on every run, on both operating systems.
// ---------------------------------------------------------------------------

/// A process that spawns, holds stdin open and never writes must produce
/// `ACP-HANDSHAKE-TIMEOUT`. If this test ever passes by returning `Ok`, the
/// green result of the handshake test above means nothing.
#[test]
fn the_handshake_timeout_is_a_loud_failure_not_a_pass() {
    let mut peer = AcpPeer::attach(spawn_node(
        "silent",
        // Holds the stdin handle open forever; writes nothing, ever.
        "process.stdin.resume();",
    ));
    let started = Instant::now();
    let outcome = peer.request(
        FIRST_REQUEST_ID,
        "initialize",
        initialize_params(),
        DISCRIMINATOR_TIMEOUT,
    );
    let elapsed = started.elapsed();
    peer.kill();

    match outcome {
        Ok(value) => panic!(
            "a process that never writes anything produced a handshake response: {value}. The \
             reader is not reading what it claims to read."
        ),
        Err(failure) => {
            let rendered = failure.to_string();
            println!("discriminator produced: {rendered}");
            assert!(
                matches!(failure, HandshakeFailure::Timeout { .. }),
                "expected a timeout against a silent process, got: {rendered}"
            );
            assert!(
                rendered.contains("ACP-HANDSHAKE-TIMEOUT"),
                "the timeout failure does not carry its marker: {rendered}"
            );
            assert!(
                elapsed >= DISCRIMINATOR_TIMEOUT,
                "the timeout fired after {elapsed:?}, before its {DISCRIMINATOR_TIMEOUT:?} bound; \
                 the deadline is not being honoured"
            );
            assert!(
                elapsed < DISCRIMINATOR_TIMEOUT * 4,
                "the timeout took {elapsed:?} against a {DISCRIMINATOR_TIMEOUT:?} bound; the read \
                 is not actually bounded"
            );
        }
    }
}

/// A process that answers nothing and exits immediately — which is precisely
/// what run 32450488248 observed and what this whole test file exists to stop
/// counting as success — must produce `ACP-HANDSHAKE-EOF`.
#[test]
fn an_immediate_exit_is_a_loud_failure_not_a_pass() {
    let mut peer = AcpPeer::attach(spawn_node("immediate-exit", "process.exit(0);"));
    let outcome = peer.request(
        FIRST_REQUEST_ID,
        "initialize",
        initialize_params(),
        DISCRIMINATOR_TIMEOUT,
    );
    peer.kill();

    match outcome {
        Ok(value) => panic!(
            "a process that exits immediately produced a handshake response: {value}. The reader \
             is not reading what it claims to read."
        ),
        Err(failure) => {
            let rendered = failure.to_string();
            println!("discriminator produced: {rendered}");
            // An immediate `process.exit(0)` can lose the race against our
            // write, in which case the failure surfaces as a broken pipe on
            // the write rather than as EOF on the read. Both are correct and
            // both are loud; what must never happen is a pass.
            assert!(
                matches!(
                    failure,
                    HandshakeFailure::Eof { .. } | HandshakeFailure::WriteFailed { .. }
                ),
                "expected EOF or a failed write against a process that exits immediately, got: {rendered}"
            );
            assert!(
                rendered.contains("ACP-HANDSHAKE-EOF")
                    || rendered.contains("ACP-HANDSHAKE-WRITE-FAILED"),
                "the failure does not carry a marker: {rendered}"
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

fn negative_control_requested() -> bool {
    matches!(
        std::env::var(NEGATIVE_CONTROL_ENV).as_deref(),
        Ok("1") | Ok("true")
    )
}

/// Replace the npm `.bin` shim the emitted launcher invokes with a program that
/// starts, holds stdin and never answers. The launcher itself, the installer
/// output around it, and the spawn are all left exactly as the real code
/// produced them.
fn sabotage_npm_bin_shim(managed_dir: &Path, executable_name: &str) {
    let bin_dir = managed_dir.join("node_modules").join(".bin");
    let mut replaced = Vec::new();

    if cfg!(windows) {
        let shim = bin_dir.join(format!("{executable_name}.cmd"));
        std::fs::write(&shim, "@echo off\r\nnode -e \"process.stdin.resume()\"\r\n")
            .unwrap_or_else(|error| panic!("could not sabotage {}: {error}", shim.display()));
        replaced.push(shim);
    } else {
        let shim = bin_dir.join(executable_name);
        std::fs::write(&shim, "#!/bin/sh\nexec node -e 'process.stdin.resume()'\n")
            .unwrap_or_else(|error| panic!("could not sabotage {}: {error}", shim.display()));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&shim, std::fs::Permissions::from_mode(0o755))
                .expect("chmod the sabotaged shim");
        }
        replaced.push(shim);
    }

    for shim in &replaced {
        println!(
            "negative control: replaced {} with a silent stub",
            shim.display()
        );
    }
    assert!(
        !replaced.is_empty(),
        "the negative control was requested but nothing was replaced"
    );
}

fn scratch_runtime_home(label: &str) -> PathBuf {
    let unique = format!(
        "anyharness-acp-handshake-{label}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    );
    let path = std::env::temp_dir().join(unique);
    std::fs::create_dir_all(&path).expect("create scratch runtime home");
    path
}
