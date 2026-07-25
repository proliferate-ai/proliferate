//! Environment containment helpers for workflow-brokered child processes.
//!
//! This is deliberately separate from workflow process isolation. Removing
//! inherited credentials limits accidental disclosure, but it does not stop a
//! same-UID process from reading runtime files, sockets, or peer processes.
//! Ordinary interactive agents and terminal/process APIs retain their existing
//! environment behavior; only workflow launches use the complete environments
//! built here.

use std::ffi::OsStr;
use std::fmt;

const RUNTIME_PRIVATE_ENV: &[&str] = &[
    "ANYHARNESS_SENTRY_DSN",
    "ANYHARNESS_SENTRY_ENVIRONMENT",
    "ANYHARNESS_SENTRY_RELEASE",
    "ANYHARNESS_SENTRY_TRACES_SAMPLE_RATE",
    "PROLIFERATE_TARGET_SENTRY_DSN",
    "PROLIFERATE_TARGET_SENTRY_ENVIRONMENT",
    "PROLIFERATE_TARGET_SENTRY_RELEASE",
    "PROLIFERATE_TARGET_SENTRY_TRACES_SAMPLE_RATE",
    "PROLIFERATE_ORG_ID",
    "PROLIFERATE_SANDBOX_ID",
    "PROLIFERATE_RUNTIME_ENV",
    "PROLIFERATE_USER_ID",
];

pub(crate) fn remove_runtime_private_env(command: &mut tokio::process::Command) {
    for key in RUNTIME_PRIVATE_ENV {
        command.env_remove(key);
    }
}

/// The small set of AnyHarness/Proliferate variables that are product inputs
/// for child processes rather than runtime-control state.
const CHILD_SAFE_ENV: &[&str] = &[
    "ANYHARNESS_WORKSPACE_ROOT",
    "PROLIFERATE_API_BASE_URL_ORIGIN",
    "PROLIFERATE_BASE_REF",
    "PROLIFERATE_BRANCH",
    "PROLIFERATE_GIT_OWNER",
    "PROLIFERATE_GIT_PROVIDER",
    "PROLIFERATE_GIT_REPO",
    "PROLIFERATE_REPO_DIR",
    "PROLIFERATE_REPO_NAME",
    "PROLIFERATE_REPO_ROOT_ID",
    "PROLIFERATE_WORKSPACE_DIR",
    "PROLIFERATE_WORKSPACE_ID",
    "PROLIFERATE_WORKSPACE_KIND",
    "PROLIFERATE_WORKTREE_DIR",
];

/// True when an environment key belongs to the runtime/control plane and must
/// never be inherited by an agent, terminal, setup shell, or generic process.
///
/// We classify the two namespaces fail-closed and keep an explicit allowlist
/// for the workspace/provider inputs children actually consume. This catches
/// newly-added data keys, bearer tokens, callback URLs, and test canaries
/// without relying on every caller to remember a growing denylist.
pub(crate) fn is_runtime_private_env_key(key: &OsStr) -> bool {
    let key = key.to_string_lossy();
    if CHILD_SAFE_ENV.iter().any(|allowed| key == *allowed) {
        return false;
    }
    key.starts_with("ANYHARNESS_") || key.starts_with("PROLIFERATE_")
}

/// Phase A has no production platform adapter, so its sealed process DTOs use
/// a deterministic, deliberately non-credentialed baseline. A later adapter
/// must replace `/var/empty` with attested per-run HOME/TMP roots as part of
/// its own scoped-environment constructor; it may never copy the control
/// process environment.
const WORKFLOW_FIXED_BASELINE_ENV: &[(&str, &str)] = &[
    ("HOME", "/var/empty"),
    ("LANG", "C"),
    ("LC_ALL", "C"),
    ("LOGNAME", "workflow-agent"),
    ("PATH", "/usr/bin:/bin"),
    ("SHELL", "/bin/sh"),
    ("TERM", "dumb"),
    ("TMPDIR", "/var/empty"),
    ("USER", "workflow-agent"),
];

fn fixed_workflow_baseline_value(key: &str) -> Option<&'static str> {
    WORKFLOW_FIXED_BASELINE_ENV
        .iter()
        .find_map(|(candidate, value)| (*candidate == key).then_some(*value))
}

fn is_workflow_agent_config_env(key: &str) -> bool {
    // Executable-selection variables (notably CLAUDE_CODE_EXECUTABLE) are
    // intentionally absent. Only the broker's immutable artifact catalog may
    // select a workflow harness executable.
    key == "ANTHROPIC_MODEL"
}

fn workflow_baseline_is_exact(pairs: &[(String, String)]) -> bool {
    WORKFLOW_FIXED_BASELINE_ENV.iter().all(|(key, value)| {
        pairs
            .iter()
            .filter(|(candidate, _)| candidate == key)
            .count()
            == 1
            && pairs
                .iter()
                .any(|(candidate, actual)| candidate == key && actual == value)
    })
}

fn workflow_route_key_allowed(agent_kind: &str, key: &str) -> bool {
    match agent_kind {
        "claude" => matches!(key, "ANTHROPIC_API_KEY" | "ANTHROPIC_AUTH_TOKEN"),
        "codex" => matches!(key, "OPENAI_API_KEY" | "CODEX_API_KEY"),
        "opencode" => matches!(
            key,
            "ANTHROPIC_API_KEY"
                | "ANTHROPIC_AUTH_TOKEN"
                | "OPENAI_API_KEY"
                | "GEMINI_API_KEY"
                | "GOOGLE_API_KEY"
                | "XAI_API_KEY"
                | "GROK_API_KEY"
        ),
        "grok" => matches!(key, "XAI_API_KEY" | "GROK_API_KEY"),
        "cursor" => key == "CURSOR_API_KEY",
        _ => false,
    }
}

fn workflow_route_credential_key(agent_kind: &str, key: &str) -> bool {
    workflow_route_key_allowed(agent_kind, key)
        && (key.ends_with("API_KEY") || key.ends_with("AUTH_TOKEN"))
}

/// Sealed complete environment for brokered workflow operations. Callers can
/// inspect it for adapter execution but cannot construct an unchecked value.
#[derive(Clone, Default, PartialEq, Eq)]
pub struct WorkflowOperationEnvironment {
    pairs: Vec<(String, String)>,
}

impl WorkflowOperationEnvironment {
    pub fn pairs(&self) -> &[(String, String)] {
        &self.pairs
    }

    pub fn iter(&self) -> impl Iterator<Item = &(String, String)> {
        self.pairs.iter()
    }

    pub(crate) fn is_policy_valid(&self) -> bool {
        workflow_baseline_is_exact(&self.pairs)
            && self.pairs.iter().all(|(key, value)| {
                fixed_workflow_baseline_value(key).is_some_and(|expected| value == expected)
                    || CHILD_SAFE_ENV.contains(&key.as_str())
            })
    }
}

impl fmt::Debug for WorkflowOperationEnvironment {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("WorkflowOperationEnvironment")
            .field(
                "keys",
                &self.pairs.iter().map(|(key, _)| key).collect::<Vec<_>>(),
            )
            .finish()
    }
}

/// Sealed complete environment for a workflow agent. The private marker binds
/// construction to a future trusted scoped-route resolver; ordinary provider,
/// native-home, and shared-gateway credentials cannot construct this type.
#[derive(Clone, PartialEq, Eq)]
pub struct WorkflowAgentEnvironment {
    agent_kind: String,
    pairs: Vec<(String, String)>,
}

impl WorkflowAgentEnvironment {
    pub fn pairs(&self) -> &[(String, String)] {
        &self.pairs
    }

    pub fn iter(&self) -> impl Iterator<Item = &(String, String)> {
        self.pairs.iter()
    }

    pub(crate) fn is_policy_valid(&self) -> bool {
        workflow_baseline_is_exact(&self.pairs)
            && self.pairs.iter().all(|(key, value)| {
                fixed_workflow_baseline_value(key).is_some_and(|expected| value == expected)
                    || CHILD_SAFE_ENV.contains(&key.as_str())
                    || is_workflow_agent_config_env(key)
                    || workflow_route_key_allowed(&self.agent_kind, key)
            })
            && self
                .pairs
                .iter()
                .any(|(key, _)| workflow_route_credential_key(&self.agent_kind, key))
    }
}

impl fmt::Debug for WorkflowAgentEnvironment {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("WorkflowAgentEnvironment")
            .field("agent_kind", &self.agent_kind)
            .field(
                "keys",
                &self.pairs.iter().map(|(key, _)| key).collect::<Vec<_>>(),
            )
            .finish()
    }
}

/// Build the environment for arbitrary workflow shell/verify/SCM operations.
/// These effects never inherit workspace/session/global secret files. Only a
/// narrow OS baseline and product-owned, non-secret workspace metadata may
/// cross the broker boundary; credentials must arrive through a scoped effect
/// capability instead of ambient environment variables.
pub(crate) fn complete_workflow_operation_env(
    explicit: impl IntoIterator<Item = (String, String)>,
) -> WorkflowOperationEnvironment {
    let mut contained = WORKFLOW_FIXED_BASELINE_ENV
        .iter()
        .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
        .collect::<std::collections::BTreeMap<_, _>>();
    for (key, value) in explicit {
        // The fixed baseline cannot be overridden by workspace/session data.
        if CHILD_SAFE_ENV.contains(&key.as_str()) {
            contained.insert(key, value);
        }
    }
    WorkflowOperationEnvironment {
        pairs: contained.into_iter().collect(),
    }
}

/// Phase-A activation gate. Existing route renderers produce direct provider,
/// native-home, or shared-gateway authority, none of which is an acceptable
/// unattended-workflow credential. A later broker-scoped resolver may become
/// the only production constructor for [`WorkflowAgentEnvironment`].
pub(crate) fn complete_workflow_agent_env(
    agent_kind: &str,
    workspace: &std::collections::BTreeMap<String, String>,
    session: &std::collections::BTreeMap<String, String>,
    route_auth: &std::collections::BTreeMap<String, String>,
    settings: &std::collections::BTreeMap<String, String>,
) -> Result<WorkflowAgentEnvironment, &'static str> {
    let _ = (agent_kind, workspace, session, route_auth, settings);
    Err(
        "workflow model route requires a run/slot/session/attempt-bound, audience-limited, expiring broker credential or local proxy; direct provider, native-home, and shared-gateway routes are unavailable",
    )
}

#[cfg(test)]
pub(crate) fn test_scoped_workflow_agent_env(
    agent_kind: &str,
    explicit: impl IntoIterator<Item = (String, String)>,
) -> WorkflowAgentEnvironment {
    // This constructor is compiled only into tests. It is not a production
    // scoped-route implementation or evidence that a typed route claim exists.
    let mut pairs = WORKFLOW_FIXED_BASELINE_ENV
        .iter()
        .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
        .collect::<Vec<_>>();
    pairs.extend(explicit);
    let environment = WorkflowAgentEnvironment {
        agent_kind: agent_kind.to_string(),
        pairs,
    };
    assert!(environment.is_policy_valid());
    environment
}

#[cfg(test)]
pub(crate) fn poisoned_workflow_agent_env(
    agent_kind: &str,
    pairs: impl IntoIterator<Item = (String, String)>,
) -> WorkflowAgentEnvironment {
    WorkflowAgentEnvironment {
        agent_kind: agent_kind.to_string(),
        pairs: pairs.into_iter().collect(),
    }
}

#[cfg(test)]
pub(crate) fn poisoned_workflow_operation_env(
    pairs: impl IntoIterator<Item = (String, String)>,
) -> WorkflowOperationEnvironment {
    WorkflowOperationEnvironment {
        pairs: pairs.into_iter().collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_namespaces_are_fail_closed_with_narrow_child_inputs() {
        for private in [
            "ANYHARNESS_DATA_KEY",
            "ANYHARNESS_BEARER_TOKEN",
            "ANYHARNESS_PRIVATE_CALLBACK_URL",
            "ANYHARNESS_CONTROL_SOCKET",
            "ANYHARNESS_SECRET_CANARY",
            "PROLIFERATE_RUNTIME_HOME",
            "PROLIFERATE_WORKFLOW_REPORT_BEARER",
            "PROLIFERATE_PRIVATE_CALLBACK_URL",
            "PROLIFERATE_SECRET_CANARY",
        ] {
            assert!(
                is_runtime_private_env_key(OsStr::new(private)),
                "{private} must be contained"
            );
        }

        for allowed in CHILD_SAFE_ENV {
            assert!(
                !is_runtime_private_env_key(OsStr::new(allowed)),
                "{allowed} is an intentional child input"
            );
        }
        assert!(!is_runtime_private_env_key(OsStr::new("PATH")));
        assert!(!is_runtime_private_env_key(OsStr::new(
            "ANTHROPIC_AUTH_TOKEN"
        )));
    }

    #[test]
    fn workflow_operation_environment_uses_positive_allowlist() {
        let contained = complete_workflow_operation_env([
            (
                "PROLIFERATE_WORKSPACE_ID".to_string(),
                "workspace-1".to_string(),
            ),
            (
                "ANTHROPIC_API_KEY".to_string(),
                "anthropic-canary".to_string(),
            ),
            ("OPENAI_API_KEY".to_string(), "openai-canary".to_string()),
            ("GH_TOKEN".to_string(), "github-canary".to_string()),
            (
                "AWS_SECRET_ACCESS_KEY".to_string(),
                "aws-canary".to_string(),
            ),
            ("USER_DEFINED_SECRET".to_string(), "user-canary".to_string()),
            ("HOME".to_string(), "/runtime/shared-auth".to_string()),
            ("PATH".to_string(), "/ambient/canary/bin".to_string()),
            ("TMPDIR".to_string(), "/runtime/private/tmp".to_string()),
            ("USER".to_string(), "control-process-user".to_string()),
            (
                "PROLIFERATE_GATEWAY_KEY".to_string(),
                "gateway-canary".to_string(),
            ),
        ]);
        assert!(contained
            .pairs()
            .iter()
            .any(|(key, value)| { key == "PROLIFERATE_WORKSPACE_ID" && value == "workspace-1" }));
        for secret in [
            "ANTHROPIC_API_KEY",
            "OPENAI_API_KEY",
            "GH_TOKEN",
            "AWS_SECRET_ACCESS_KEY",
            "USER_DEFINED_SECRET",
            "PROLIFERATE_GATEWAY_KEY",
        ] {
            assert!(contained.pairs().iter().all(|(key, _)| key != secret));
        }
        for (key, value) in WORKFLOW_FIXED_BASELINE_ENV {
            assert_eq!(
                contained
                    .pairs()
                    .iter()
                    .find_map(|(candidate, actual)| (candidate == key).then_some(actual.as_str())),
                Some(*value),
                "{key} must come from the deterministic baseline"
            );
        }
        assert!(contained.is_policy_valid());
    }

    #[test]
    fn env_clear_child_canary_receives_only_fixed_baseline_and_explicit_metadata() {
        let environment = complete_workflow_operation_env([
            (
                "PROLIFERATE_WORKSPACE_ID".to_string(),
                "workspace-canary".to_string(),
            ),
            (
                "ANYHARNESS_BEARER_TOKEN".to_string(),
                "runtime-secret-canary".to_string(),
            ),
            ("PATH".to_string(), "/ambient-path-canary".to_string()),
            (
                "CLAUDE_CODE_EXECUTABLE".to_string(),
                "/tmp/executable-bypass-canary".to_string(),
            ),
        ]);
        let mut command = std::process::Command::new("/usr/bin/env");
        command.env_clear();
        command.envs(environment.iter().cloned());
        let output = command.output().expect("run env canary");
        assert!(output.status.success());
        let stdout = String::from_utf8(output.stdout).expect("utf8 env output");
        assert!(stdout.contains("PROLIFERATE_WORKSPACE_ID=workspace-canary"));
        assert!(stdout.contains("PATH=/usr/bin:/bin"));
        for canary in [
            "runtime-secret-canary",
            "ambient-path-canary",
            "executable-bypass-canary",
            "CLAUDE_CODE_EXECUTABLE=",
        ] {
            assert!(!stdout.contains(canary), "child leaked {canary}");
        }
    }

    #[test]
    fn workflow_agent_direct_and_shared_routes_are_unavailable() {
        let workspace = std::collections::BTreeMap::new();
        let session = std::collections::BTreeMap::new();
        let settings = std::collections::BTreeMap::new();
        for (agent_kind, credential_key) in [
            ("claude", "ANTHROPIC_API_KEY"),
            ("claude", "ANTHROPIC_AUTH_TOKEN"),
            ("codex", "OPENAI_API_KEY"),
            ("codex", "CODEX_API_KEY"),
            ("opencode", "GOOGLE_API_KEY"),
            ("grok", "XAI_API_KEY"),
            ("cursor", "CURSOR_API_KEY"),
            ("codex", "PROLIFERATE_GATEWAY_KEY"),
        ] {
            let route = std::collections::BTreeMap::from([(
                credential_key.to_string(),
                "long-lived-or-shared-canary".to_string(),
            )]);
            let error =
                complete_workflow_agent_env(agent_kind, &workspace, &session, &route, &settings)
                    .expect_err("unscoped workflow route must remain unavailable");
            assert!(error.contains("run/slot/session/attempt-bound"));
        }
    }

    #[test]
    fn workflow_agent_route_rejects_process_control_and_shared_home_keys() {
        let workspace = std::collections::BTreeMap::new();
        let session = std::collections::BTreeMap::new();
        let settings = std::collections::BTreeMap::new();
        for malicious in [
            "DYLD_INSERT_LIBRARIES",
            "LD_PRELOAD",
            "BASH_ENV",
            "ENV",
            "NODE_OPTIONS",
            "PYTHONPATH",
            "PATH",
            "HOME",
            "SHELL",
            "GIT_CONFIG_COUNT",
            "SSH_ASKPASS",
            "CODEX_HOME",
            "CLAUDE_CODE_EXECUTABLE",
        ] {
            let route = std::collections::BTreeMap::from([
                ("ANTHROPIC_AUTH_TOKEN".to_string(), "selected".to_string()),
                (malicious.to_string(), "canary".to_string()),
            ]);
            assert!(
                complete_workflow_agent_env("claude", &workspace, &session, &route, &settings,)
                    .is_err(),
                "route key {malicious} must fail closed"
            );
        }
    }
}

pub(crate) fn remove_runtime_private_pty_env(command: &mut portable_pty::CommandBuilder) {
    for key in RUNTIME_PRIVATE_ENV {
        command.env_remove(key);
    }
}
