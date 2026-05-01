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
    Amp,
}

impl AgentKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Gemini => "gemini",
            Self::Cursor => "cursor",
            Self::OpenCode => "opencode",
            Self::Amp => "amp",
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Claude => "Claude",
            Self::Codex => "Codex",
            Self::Gemini => "Gemini",
            Self::Cursor => "Cursor",
            Self::OpenCode => "OpenCode",
            Self::Amp => "Amp",
        }
    }

    pub fn all() -> &'static [AgentKind] {
        &[
            Self::Claude,
            Self::Codex,
            Self::Gemini,
            Self::Cursor,
            Self::OpenCode,
            Self::Amp,
        ]
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "claude" => Some(Self::Claude),
            "codex" => Some(Self::Codex),
            "gemini" => Some(Self::Gemini),
            "cursor" => Some(Self::Cursor),
            "opencode" => Some(Self::OpenCode),
            "amp" => Some(Self::Amp),
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
/// Each variant maps to an explicit detector function in `credentials.rs`.
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
    /// Check OpenCode-specific auth.json (multi-provider).
    OpenCode,
    /// Check Cursor-specific ~/.cursor/cli-config.json for login state.
    Cursor,
    /// Check Amp-specific ~/.amp/config.json for API key fields.
    Amp,
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

/// Authentication/credential hints for an agent.
#[derive(Debug, Clone)]
pub struct AuthSpec {
    /// Environment variable names that provide API key credentials (any-of semantics).
    pub env_vars: Vec<String>,
    /// Optional native CLI login flow metadata.
    pub login: Option<LoginSpec>,
    /// Which provider-specific credential file discovery to attempt.
    pub discovery: CredentialDiscoveryKind,
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
    pub status: ModelCatalogStatus,
    pub aliases: Vec<String>,
    pub min_runtime_version: Option<String>,
    pub launch_remediation: Option<ModelLaunchRemediationMetadata>,
}

/// Runtime-owned lifecycle status for one model catalog row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelCatalogStatus {
    Candidate,
    Active,
    Deprecated,
    Hidden,
}

/// Product-owned remediation class for a launch-time live-apply mismatch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
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
    pub native: Option<ResolvedArtifact>,
    pub agent_process: ResolvedArtifact,
    pub spawn: Option<SpawnSpec>,
}
