use std::collections::HashMap;
use std::path::PathBuf;

/// Identifies which coding-agent family this descriptor represents.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum AgentKind {
    Claude,
    Codex,
    Gemini,
    Cursor,
    OpenCode,
    Grok,
}

impl AgentKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Gemini => "gemini",
            Self::Cursor => "cursor",
            Self::OpenCode => "opencode",
            Self::Grok => "grok",
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Claude => "Claude",
            Self::Codex => "Codex",
            Self::Gemini => "Gemini",
            Self::Cursor => "Cursor",
            Self::OpenCode => "OpenCode",
            Self::Grok => "Grok",
        }
    }

    pub fn all() -> &'static [AgentKind] {
        &[
            Self::Claude,
            Self::Codex,
            Self::Gemini,
            Self::Cursor,
            Self::OpenCode,
            Self::Grok,
        ]
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "claude" => Some(Self::Claude),
            "codex" => Some(Self::Codex),
            "gemini" => Some(Self::Gemini),
            "cursor" => Some(Self::Cursor),
            "opencode" => Some(Self::OpenCode),
            "grok" => Some(Self::Grok),
            _ => None,
        }
    }
}

/// A structured command representation used for install, login, and launch commands.
#[derive(Debug, Clone)]
pub struct CommandSpec {
    /// The program to execute (e.g. "npm", "claude", "codex").
    pub program: String,
    /// Arguments to pass to the program.
    pub args: Vec<String>,
}

/// Whether an artifact is the native CLI or the ACP wrapper / agent-process binary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ArtifactRole {
    /// The vendor's own CLI binary (e.g. `claude`, `codex`).
    NativeCli,
    /// The ACP-facing executable surface AnyHarness will supervise (e.g. `claude-agent-acp`).
    AgentProcess,
}

// ---------------------------------------------------------------------------
// Native install strategy
// ---------------------------------------------------------------------------

/// How a native CLI artifact can be installed or discovered.
#[derive(Debug, Clone)]
pub enum NativeInstallSpec {
    /// Download a single binary blob from a well-known URL and write it to a managed path.
    DirectBinary {
        /// URL that returns the latest version string (fetched if no version override is given).
        latest_version_url: Option<String>,
        /// URL template with `{version}` and `{platform}` placeholders for the binary download.
        binary_url_template: String,
        /// Maps the current platform to a string used in the URL template.
        platform_map: Vec<(Platform, String)>,
    },
    /// Download a tarball from GitHub-style releases, extract the expected binary, move it to a managed path.
    TarballRelease {
        /// URL template for latest release (no version tag).
        latest_url_template: String,
        /// URL template with `{version}` and `{target}` placeholders for a tagged release.
        versioned_url_template: String,
        /// Template for the expected binary name inside the archive, with `{target}` placeholder.
        expected_binary_template: String,
        /// Maps the current platform to a target triple or segment string.
        platform_map: Vec<(Platform, String)>,
    },
    /// Resolve exclusively from PATH; no managed install is supported.
    PathOnly {
        /// Binary names to search for on PATH.
        candidate_binaries: Vec<String>,
        /// URL the UI can link to for manual install docs.
        docs_url: Option<String>,
    },
    /// No automated install; docs-only guidance.
    Manual { docs_url: String },
}

/// Represents the current platform for install-recipe URL interpolation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Platform {
    MacosArm64,
    MacosX64,
    LinuxX64,
    LinuxArm64,
    WindowsX64,
    WindowsArm64,
}

impl Platform {
    pub fn detect() -> Option<Self> {
        let os = std::env::consts::OS;
        let arch = std::env::consts::ARCH;
        match (os, arch) {
            ("macos", "aarch64") => Some(Self::MacosArm64),
            ("macos", "x86_64") => Some(Self::MacosX64),
            ("linux", "x86_64") => Some(Self::LinuxX64),
            ("linux", "aarch64") => Some(Self::LinuxArm64),
            ("windows", "x86_64") => Some(Self::WindowsX64),
            ("windows", "aarch64") => Some(Self::WindowsArm64),
            _ => None,
        }
    }

    pub fn from_target_triple(target: &str) -> Option<Self> {
        match target {
            "aarch64-apple-darwin" => Some(Self::MacosArm64),
            "x86_64-apple-darwin" => Some(Self::MacosX64),
            "x86_64-unknown-linux-gnu" | "x86_64-unknown-linux-musl" => Some(Self::LinuxX64),
            "aarch64-unknown-linux-gnu" | "aarch64-unknown-linux-musl" => Some(Self::LinuxArm64),
            "x86_64-pc-windows-msvc" => Some(Self::WindowsX64),
            "aarch64-pc-windows-msvc" => Some(Self::WindowsArm64),
            _ => None,
        }
    }

    pub fn current_target_triple() -> Option<&'static str> {
        Self::detect().map(|platform| platform.target_triple())
    }

    pub fn target_triple(self) -> &'static str {
        match self {
            Self::MacosArm64 => "aarch64-apple-darwin",
            Self::MacosX64 => "x86_64-apple-darwin",
            Self::LinuxX64 => "x86_64-unknown-linux-gnu",
            Self::LinuxArm64 => "aarch64-unknown-linux-gnu",
            Self::WindowsX64 => "x86_64-pc-windows-msvc",
            Self::WindowsArm64 => "aarch64-pc-windows-msvc",
        }
    }

    pub fn node_binary_name(self) -> &'static str {
        match self {
            Self::WindowsX64 | Self::WindowsArm64 => "node.exe",
            _ => "node",
        }
    }

    /// The registry/catalog platform-map key (`macos_arm64`, `linux_x64`, …)
    /// used to index a pin's per-target downloads.
    pub fn registry_key(self) -> &'static str {
        match self {
            Self::MacosArm64 => "macos_arm64",
            Self::MacosX64 => "macos_x64",
            Self::LinuxX64 => "linux_x64",
            Self::LinuxArm64 => "linux_arm64",
            Self::WindowsX64 => "windows_x64",
            Self::WindowsArm64 => "windows_arm64",
        }
    }
}

/// Describes the native CLI artifact for an agent (optional; not all agents have one).
#[derive(Debug, Clone)]
pub struct NativeArtifactSpec {
    pub install: NativeInstallSpec,
}

// ---------------------------------------------------------------------------
// Agent-process install strategy
// ---------------------------------------------------------------------------

/// How the ACP wrapper / agent-process artifact can be installed or discovered.
#[derive(Debug, Clone)]
pub enum AgentProcessInstallSpec {
    /// Use the ACP registry as the primary install source, with a local fallback.
    RegistryBacked {
        /// The agent id in the ACP registry (e.g. "claude-acp", "codex-acp").
        registry_id: String,
        /// Local fallback if registry lookup fails or has no compatible distribution.
        fallback: AgentProcessFallback,
    },
    /// Install a specific npm package into the managed artifact dir and launch it there.
    ManagedNpmPackage {
        /// The npm install specifier, optionally pinned to a default version or git ref.
        package: String,
        /// Optional subdirectory within the package source tree that contains the installable npm package.
        package_subdir: Option<PathBuf>,
        /// Optional binary to build directly from the package source tree instead of installing the npm wrapper.
        source_build_binary_name: Option<String>,
        /// Path to the binary inside node_modules after install.
        executable_relpath: PathBuf,
    },
    /// Resolve exclusively from PATH; no managed install is supported.
    PathOnly {
        /// Binary names to search for on PATH.
        candidate_binaries: Vec<String>,
        /// Default args the agent needs for ACP mode (e.g. ["--acp"]).
        default_args: Vec<String>,
        /// URL the UI can link to for manual install docs.
        docs_url: Option<String>,
    },
    /// No automated install; docs-only guidance.
    Manual { docs_url: String },
}

/// Local fallback install rule when the ACP registry is unavailable or incomplete.
#[derive(Debug, Clone)]
pub enum AgentProcessFallback {
    /// Install an npm package and generate a managed launcher.
    NpmPackage {
        /// The npm install specifier (e.g. "@proliferate/claude-agent-acp" or a git URL).
        package: String,
        /// Optional subdirectory within the package source tree that contains the installable npm package.
        package_subdir: Option<PathBuf>,
        /// Optional binary to build directly from the package source tree instead of installing the npm wrapper.
        source_build_binary_name: Option<String>,
        /// Path to the binary inside node_modules after install.
        executable_relpath: PathBuf,
    },
    /// The native CLI itself provides the ACP surface via a subcommand (e.g. `opencode acp`).
    NativeSubcommand { args: Vec<String> },
    /// A known binary name that might exist on PATH already.
    BinaryHint {
        candidate_binaries: Vec<String>,
        args: Vec<String>,
    },
}

/// Describes the agent-process artifact for an agent.
#[derive(Debug, Clone)]
pub struct AgentProcessArtifactSpec {
    pub install: AgentProcessInstallSpec,
}

// ---------------------------------------------------------------------------
// Auth / credential discovery
// ---------------------------------------------------------------------------

/// Selects which provider-specific credential detection logic to run.
/// Each variant maps to an explicit detector function in the credentials module.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CredentialDiscoveryKind {
    /// No local credential discovery; rely only on env vars.
    None,
    /// Check Claude-specific config/auth files (API key + OAuth).
    Claude,
    /// Check Codex-specific auth.json (API key + OAuth).
    Codex,
    /// Check Gemini-specific OAuth cache files.
    Gemini,
    /// Check OpenCode-specific auth.json (multi-provider), while leaving
    /// readiness provider-managed when no local auth file exists.
    OpenCode,
    /// Check Cursor-specific ~/.cursor/cli-config.json for login state.
    Cursor,
    /// Check Grok-specific ~/.grok/auth.json for a cached login token.
    Grok,
}

/// Describes how to log in with this agent's native CLI if env-based auth is missing.
#[derive(Debug, Clone)]
pub struct LoginSpec {
    /// Human-readable label for the login action (e.g. "Log in with Claude").
    pub label: String,
    /// The terminal command the UI should run to start the login flow.
    pub command: CommandSpec,
    /// Whether the managed binary will reuse existing user-level login state.
    pub reuses_user_state: bool,
    /// Optional instruction text the UI can show alongside the command.
    pub message: Option<String>,
}

/// How credential state contributes to overall launch readiness.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthReadinessPolicy {
    /// At least one required slot must be locally satisfied.
    AnyRequiredSlot,
    /// Every required slot must be locally satisfied.
    AllRequiredSlots,
    /// The harness can launch without local credentials and will resolve provider auth itself.
    ProviderManaged,
    /// This harness has no local auth requirement.
    None,
}

/// Gateway env materialization policy for one auth slot.
#[derive(Debug, Clone)]
pub struct GatewayEnvMaterializationSpec {
    pub protocol_facade: String,
    pub protected_env_keys: Vec<String>,
    pub support_env_keys: Vec<String>,
}

/// Synced-file materialization policy for one auth slot.
#[derive(Debug, Clone)]
pub struct SyncedFilesMaterializationSpec {
    pub protected_env_keys: Vec<String>,
    pub allowed_file_paths: Vec<String>,
    pub cleanup_file_paths: Vec<String>,
}

/// Cloud/local credential materialization policy for one auth slot.
#[derive(Debug, Clone, Default)]
pub struct AuthMaterializationSpec {
    pub gateway_env: Option<GatewayEnvMaterializationSpec>,
    pub synced_files: Option<SyncedFilesMaterializationSpec>,
}

/// A provider-addressable credential slot for one harness.
#[derive(Debug, Clone)]
pub struct AuthSlotSpec {
    pub id: String,
    pub label: String,
    pub credential_provider_ids: Vec<String>,
    pub required_for_readiness: bool,
    pub env_vars: Vec<String>,
    pub login: Option<LoginSpec>,
    pub discovery: CredentialDiscoveryKind,
    pub materialization: AuthMaterializationSpec,
}

/// Authentication/credential hints for an agent.
#[derive(Debug, Clone)]
pub struct AuthSpec {
    pub readiness_policy: AuthReadinessPolicy,
    pub slots: Vec<AuthSlotSpec>,
}

impl AuthSpec {
    pub fn expected_env_vars(&self) -> Vec<String> {
        let mut vars = Vec::new();
        for slot in &self.slots {
            for env_var in &slot.env_vars {
                if !vars.contains(env_var) {
                    vars.push(env_var.clone());
                }
            }
        }
        vars
    }

    pub fn primary_login(&self) -> Option<&LoginSpec> {
        self.slots.iter().find_map(|slot| slot.login.as_ref())
    }

    pub fn supports_login(&self) -> bool {
        self.primary_login().is_some()
    }

    pub fn slot(&self, auth_slot_id: &str) -> Option<&AuthSlotSpec> {
        self.slots.iter().find(|slot| slot.id == auth_slot_id)
    }

    #[cfg(test)]
    pub fn test_single_required_slot(
        env_vars: Vec<String>,
        login: Option<LoginSpec>,
        discovery: CredentialDiscoveryKind,
    ) -> Self {
        Self {
            readiness_policy: AuthReadinessPolicy::AnyRequiredSlot,
            slots: vec![AuthSlotSpec {
                id: "default".into(),
                label: "Default".into(),
                credential_provider_ids: vec!["default".into()],
                required_for_readiness: true,
                env_vars,
                login,
                discovery,
                materialization: AuthMaterializationSpec::default(),
            }],
        }
    }
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

/// Template for how to launch this agent's ACP process once it is installed.
#[derive(Debug, Clone)]
pub struct LaunchSpecTemplate {
    /// The expected executable name (used for PATH fallback and display).
    pub executable_name: String,
    /// Default args to pass when launching (e.g. ["--acp"]).
    pub default_args: Vec<String>,
}

// ---------------------------------------------------------------------------
// Agent descriptor (the complete static metadata for one agent kind)
// ---------------------------------------------------------------------------

/// Complete static metadata for one supported agent kind.
#[derive(Debug, Clone)]
pub struct AgentDescriptor {
    /// Which agent family this is.
    pub kind: AgentKind,
    /// Optional native CLI artifact spec (only if the agent needs a separate native CLI).
    pub native: Option<NativeArtifactSpec>,
    /// The ACP wrapper / agent-process artifact spec (always required).
    pub agent_process: AgentProcessArtifactSpec,
    /// How to launch the agent-process binary once resolved.
    pub launch: LaunchSpecTemplate,
    /// Auth/credential configuration for this agent.
    pub auth: AuthSpec,
    /// URL for the agent's docs or repo (shown in UI).
    pub docs_url: Option<String>,
}

// ---------------------------------------------------------------------------
// Resolved runtime state
// ---------------------------------------------------------------------------

/// The result of credential detection for one agent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CredentialState {
    /// At least one valid credential source was found.
    Ready,
    /// No env vars set but existing local login/config state was found.
    ReadyViaLocalAuth,
    /// No credentials found; env var setup is needed.
    MissingEnv,
    /// No credentials found; native login is the recommended path.
    LoginRequired,
}

/// The overall readiness of one agent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolvedAgentStatus {
    Ready,
    InstallRequired,
    CredentialsRequired,
    LoginRequired,
    Unsupported,
    Error,
}

/// Describes the final launch command for an agent after full resolution.
#[derive(Debug, Clone)]
pub struct SpawnSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub cwd: Option<PathBuf>,
}

// ---------------------------------------------------------------------------
// Model registry catalog
// ---------------------------------------------------------------------------

/// Runtime-owned model registry metadata used by session validation and launch defaults.
#[derive(Debug, Clone)]
pub struct ModelRegistryMetadata {
    pub kind: String,
    pub display_name: String,
    pub default_model_id: Option<String>,
    pub models: Vec<ModelRegistryModelMetadata>,
}

/// Runtime-owned model metadata for one harness registry row.
#[derive(Debug, Clone)]
pub struct ModelRegistryModelMetadata {
    pub id: String,
    pub display_name: String,
    pub description: Option<String>,
    pub is_default: bool,
    pub default_opt_in: Option<bool>,
    pub status: ModelCatalogStatus,
    pub aliases: Vec<String>,
    pub min_runtime_version: Option<String>,
    pub launch_remediation: Option<ModelLaunchRemediationMetadata>,
    pub session_default_controls: Vec<SessionDefaultControlMetadata>,
    pub session_default_controls_state: SessionDefaultControlsState,
}

/// Runtime-owned lifecycle status for one model catalog row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelCatalogStatus {
    Candidate,
    Active,
    Deprecated,
    Hidden,
}

/// Product-owned remediation class for a launch-time live-apply mismatch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelLaunchRemediationKind {
    ManagedReinstall,
    ExternalUpdate,
    Restart,
}

/// Runtime-owned catalog remediation metadata.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
pub struct ModelLaunchRemediationMetadata {
    pub kind: ModelLaunchRemediationKind,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionDefaultControlKey {
    Reasoning,
    Effort,
    FastMode,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
pub struct SessionDefaultControlValueMetadata {
    pub value: String,
    pub label: String,
    pub description: Option<String>,
    pub is_default: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
pub struct SessionDefaultControlMetadata {
    pub key: SessionDefaultControlKey,
    pub label: String,
    pub values: Vec<SessionDefaultControlValueMetadata>,
    pub default_value: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionDefaultControlsState {
    Omitted,
    Empty,
    Valid,
    Invalid,
}

/// Machine-local resolved state for one artifact (native or agent-process).
#[derive(Debug, Clone)]
pub struct ResolvedArtifact {
    pub role: ArtifactRole,
    pub installed: bool,
    pub source: Option<String>,
    pub version: Option<String>,
    pub path: Option<PathBuf>,
    pub message: Option<String>,
}

/// Machine-local resolved state for one complete agent.
#[derive(Debug, Clone)]
pub struct ResolvedAgent {
    pub descriptor: AgentDescriptor,
    pub status: ResolvedAgentStatus,
    pub credential_state: CredentialState,
    pub auth_slots: Vec<ResolvedAuthSlot>,
    pub native: Option<ResolvedArtifact>,
    pub agent_process: ResolvedArtifact,
    pub spawn: Option<SpawnSpec>,
}

/// Machine-local resolved credential state for one auth slot.
#[derive(Debug, Clone)]
pub struct ResolvedAuthSlot {
    pub spec: AuthSlotSpec,
    pub credential_state: CredentialState,
}
