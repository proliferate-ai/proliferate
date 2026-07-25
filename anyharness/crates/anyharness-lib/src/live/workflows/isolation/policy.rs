//! Isolation policy, attestation, capabilities, and local broker binding.

use std::collections::BTreeSet;
use std::fmt;
use std::path::PathBuf;

use sha2::{Digest, Sha256};

use super::{WorkflowDeliveryIdentity, WorkflowIsolationBroker, WorkflowIsolationError};

/// The enforcement mechanism the platform attests. There is deliberately no
/// boolean or environment-variable arm: adapters must name a concrete boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkflowIsolationEnforcement {
    SeparateOsPrincipal,
    PlatformSandbox,
    ContainerNamespace,
}

/// Agent-facing gateway address issued by the trusted local broker. It carries
/// no remote bearer, activation id, callback credential, or arbitrary headers.
pub const LOCAL_BROKER_CAPABILITY_HEADER: &str = "x-proliferate-workflow-broker-capability";

#[derive(Clone, PartialEq, Eq)]
pub struct TrustedLocalGatewayBinding {
    endpoint: String,
    session_id: String,
    execution_generation: i64,
    broker_generation: u64,
    capability: String,
}

impl TrustedLocalGatewayBinding {
    pub fn try_new(
        endpoint: impl Into<String>,
        session_id: impl Into<String>,
        execution_generation: i64,
        broker_generation: u64,
        capability: impl Into<String>,
    ) -> Result<Self, WorkflowIsolationError> {
        let endpoint = endpoint.into();
        let session_id = session_id.into();
        let capability = capability.into();
        let parsed = url::Url::parse(&endpoint)
            .map_err(|_| WorkflowIsolationError::InvalidLocalGatewayBinding)?;
        let is_local_ip_literal = matches!(parsed.host_str(), Some("127.0.0.1" | "::1"));
        let has_explicit_nonzero_port = parsed.port().is_some_and(|port| port != 0);
        if endpoint.len() > 2_048
            || !endpoint.is_ascii()
            || parsed.scheme() != "http"
            || !is_local_ip_literal
            || !has_explicit_nonzero_port
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.path() != "/mcp"
            || parsed.query().is_some()
            || parsed.fragment().is_some()
            || !valid_local_session_id(&session_id)
            || execution_generation <= 0
            || broker_generation == 0
            || capability.is_empty()
            || capability.len() > 4_096
            || !capability.bytes().all(|byte| byte.is_ascii_graphic())
        {
            return Err(WorkflowIsolationError::InvalidLocalGatewayBinding);
        }
        Ok(Self {
            endpoint,
            session_id,
            execution_generation,
            broker_generation,
            capability,
        })
    }

    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn execution_generation(&self) -> i64 {
        self.execution_generation
    }

    pub fn broker_generation(&self) -> u64 {
        self.broker_generation
    }

    /// Agent-visible, local-broker-only capability. Never send this value to
    /// the remote integration gateway or persist it in workflow/session SQLite.
    pub fn capability(&self) -> &str {
        &self.capability
    }
}

fn valid_local_session_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value == value.trim()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

impl fmt::Debug for TrustedLocalGatewayBinding {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TrustedLocalGatewayBinding")
            .field("endpoint", &self.endpoint)
            .field("session_id", &self.session_id)
            .field("execution_generation", &self.execution_generation)
            .field("broker_generation", &self.broker_generation)
            .field("capability", &"[REDACTED]")
            .finish()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum WorkflowIsolationGuarantee {
    FilesystemDefaultDeny,
    NetworkDefaultDeny,
    RuntimeHomeFilesystemDenied,
    RuntimePrivateEnvironmentDenied,
    RuntimeProcessInspectionDenied,
    RuntimeProcessSignalDenied,
    ControlNetworkDenied,
    WorkspaceReadWrite,
    BrokeredProcessIo,
}

pub(super) const REQUIRED_GUARANTEES: [WorkflowIsolationGuarantee; 9] = [
    WorkflowIsolationGuarantee::FilesystemDefaultDeny,
    WorkflowIsolationGuarantee::NetworkDefaultDeny,
    WorkflowIsolationGuarantee::RuntimeHomeFilesystemDenied,
    WorkflowIsolationGuarantee::RuntimePrivateEnvironmentDenied,
    WorkflowIsolationGuarantee::RuntimeProcessInspectionDenied,
    WorkflowIsolationGuarantee::RuntimeProcessSignalDenied,
    WorkflowIsolationGuarantee::ControlNetworkDenied,
    WorkflowIsolationGuarantee::WorkspaceReadWrite,
    WorkflowIsolationGuarantee::BrokeredProcessIo,
];

/// Runtime-owned semantics an isolation adapter must enforce. The canonical
/// document is deliberately platform-neutral: Phase-B adapters choose the OS
/// mechanism, but they must attest this exact deny/allow contract.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkflowIsolationPolicy {
    version: &'static str,
    denied_runtime_roots: Vec<PathBuf>,
    denied_control_endpoints: Vec<String>,
    allowed_workspace_roots: Vec<PathBuf>,
    allowed_materialization_roots: Vec<PathBuf>,
    denied_process: &'static [&'static str],
    filesystem_rule: &'static str,
    network_rule: &'static str,
    environment_rule: &'static str,
}

impl WorkflowIsolationPolicy {
    pub fn try_new(
        denied_runtime_roots: impl IntoIterator<Item = PathBuf>,
        denied_control_endpoints: impl IntoIterator<Item = String>,
        allowed_workspace_roots: impl IntoIterator<Item = PathBuf>,
        allowed_materialization_roots: impl IntoIterator<Item = PathBuf>,
    ) -> Result<Self, WorkflowIsolationError> {
        let denied_runtime_roots = canonical_root_set(denied_runtime_roots)?;
        let allowed_workspace_roots = canonical_root_set(allowed_workspace_roots)?;
        let allowed_materialization_roots = canonical_root_set(allowed_materialization_roots)?;
        let mut denied_control_endpoints = denied_control_endpoints
            .into_iter()
            .map(canonical_control_endpoint)
            .collect::<Result<Vec<_>, _>>()?;
        denied_control_endpoints.sort();
        denied_control_endpoints.dedup();
        if denied_runtime_roots.is_empty()
            || denied_control_endpoints.is_empty()
            || allowed_workspace_roots.is_empty()
            || denied_runtime_roots.iter().any(|denied| {
                allowed_workspace_roots
                    .iter()
                    .chain(allowed_materialization_roots.iter())
                    .any(|allowed| allowed.starts_with(denied) || denied.starts_with(allowed))
            })
        {
            return Err(WorkflowIsolationError::InvalidPolicy);
        }
        Ok(Self {
            version: "workflow-isolation-policy/v1",
            denied_runtime_roots,
            denied_control_endpoints,
            allowed_workspace_roots,
            allowed_materialization_roots,
            denied_process: &["inspect_runtime_principal", "signal_runtime_principal"],
            filesystem_rule:
                "deny_all_except_exact_workspace_materialization_and_harness_artifacts",
            network_rule: "deny_all_control_and_private_loopback_except_authenticated_local_broker",
            environment_rule: "env_clear_then_narrow_os_baseline_plus_explicit_resolved_inputs",
        })
    }

    pub fn version(&self) -> &str {
        self.version
    }

    pub fn digest(&self) -> String {
        let canonical = serde_json::to_vec(&serde_json::json!({
            "allowedMaterializationRoots": path_strings(&self.allowed_materialization_roots),
            "allowedWorkspaceRoots": path_strings(&self.allowed_workspace_roots),
            "deniedControlEndpoints": self.denied_control_endpoints,
            "deniedProcess": self.denied_process,
            "deniedRuntimeRoots": path_strings(&self.denied_runtime_roots),
            "environmentRule": self.environment_rule,
            "filesystemRule": self.filesystem_rule,
            "networkRule": self.network_rule,
            "version": self.version,
        }))
        .expect("workflow isolation policy is JSON-serializable");
        format!("sha256:{:x}", Sha256::digest(&canonical))
    }

    pub fn allows_cwd(&self, cwd: &std::path::Path) -> bool {
        canonical_declared_root(cwd).is_ok_and(|cwd| {
            self.allowed_workspace_roots
                .iter()
                .chain(self.allowed_materialization_roots.iter())
                .any(|root| cwd.starts_with(root))
                && self
                    .denied_runtime_roots
                    .iter()
                    .all(|denied| !cwd.starts_with(denied))
        })
    }

    pub fn permits_materialization(
        &self,
        source: &std::path::Path,
        target: &std::path::Path,
    ) -> bool {
        let Ok(source) = canonical_declared_root(source) else {
            return false;
        };
        let Ok(target) = canonical_declared_root(target) else {
            return false;
        };
        self.allowed_workspace_roots
            .iter()
            .chain(self.allowed_materialization_roots.iter())
            .any(|root| source.starts_with(root))
            && self
                .allowed_materialization_roots
                .iter()
                .any(|root| target == *root)
            && self
                .denied_runtime_roots
                .iter()
                .all(|denied| !source.starts_with(denied) && !target.starts_with(denied))
    }
}

fn path_strings(paths: &[PathBuf]) -> Vec<String> {
    paths
        .iter()
        .map(|path| {
            path.to_str()
                .expect("workflow policy rejects non-UTF-8 paths")
                .to_string()
        })
        .collect()
}

fn canonical_root_set(
    roots: impl IntoIterator<Item = PathBuf>,
) -> Result<Vec<PathBuf>, WorkflowIsolationError> {
    let mut roots = roots
        .into_iter()
        .map(|root| canonical_declared_root(&root))
        .collect::<Result<Vec<_>, _>>()?;
    if roots.iter().any(|root| root.to_str().is_none()) {
        return Err(WorkflowIsolationError::InvalidPolicy);
    }
    roots.sort();
    roots.dedup();
    Ok(roots)
}

pub(super) fn canonical_declared_root(
    path: &std::path::Path,
) -> Result<PathBuf, WorkflowIsolationError> {
    if !path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(WorkflowIsolationError::InvalidPolicy);
    }
    if path.exists() {
        return std::fs::canonicalize(path).map_err(|_| WorkflowIsolationError::InvalidPolicy);
    }
    let mut ancestor = path;
    let mut suffix = Vec::new();
    while !ancestor.exists() {
        let Some(name) = ancestor.file_name() else {
            return Err(WorkflowIsolationError::InvalidPolicy);
        };
        suffix.push(name.to_os_string());
        ancestor = ancestor
            .parent()
            .ok_or(WorkflowIsolationError::InvalidPolicy)?;
    }
    let mut canonical =
        std::fs::canonicalize(ancestor).map_err(|_| WorkflowIsolationError::InvalidPolicy)?;
    for component in suffix.into_iter().rev() {
        canonical.push(component);
    }
    Ok(canonical)
}

pub(super) fn canonical_control_endpoint(
    endpoint: String,
) -> Result<String, WorkflowIsolationError> {
    let parsed = url::Url::parse(&endpoint).map_err(|_| WorkflowIsolationError::InvalidPolicy)?;
    if parsed.scheme() != "http"
        || !matches!(parsed.host_str(), Some("127.0.0.1" | "::1"))
        || !parsed.port().is_some_and(|port| port != 0)
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(WorkflowIsolationError::InvalidPolicy);
    }
    Ok(parsed.to_string().trim_end_matches('/').to_string())
}

#[derive(Clone, PartialEq, Eq)]
pub struct WorkflowIsolationAttestation {
    capability_id: String,
    identity: WorkflowDeliveryIdentity,
    backend_version: String,
    policy_version: String,
    broker_generation: u64,
    policy_digest: String,
    enforcement: WorkflowIsolationEnforcement,
    proven_guarantees: BTreeSet<WorkflowIsolationGuarantee>,
}

impl WorkflowIsolationAttestation {
    pub fn new(
        capability_id: impl Into<String>,
        identity: WorkflowDeliveryIdentity,
        backend_version: impl Into<String>,
        policy_version: impl Into<String>,
        broker_generation: u64,
        policy_digest: impl Into<String>,
        enforcement: WorkflowIsolationEnforcement,
        proven_guarantees: impl IntoIterator<Item = WorkflowIsolationGuarantee>,
    ) -> Result<Self, WorkflowIsolationError> {
        let capability_id = capability_id.into();
        let backend_version = backend_version.into();
        let policy_version = policy_version.into();
        let policy_digest = policy_digest.into();
        let proven_guarantees = proven_guarantees.into_iter().collect::<BTreeSet<_>>();
        if capability_id.trim().is_empty()
            || backend_version.trim().is_empty()
            || policy_version.trim().is_empty()
            || broker_generation == 0
            || !valid_policy_digest(&policy_digest)
            || REQUIRED_GUARANTEES
                .iter()
                .any(|required| !proven_guarantees.contains(required))
        {
            return Err(WorkflowIsolationError::InvalidAttestation);
        }
        Ok(Self {
            capability_id,
            identity,
            backend_version,
            policy_version,
            broker_generation,
            policy_digest,
            enforcement,
            proven_guarantees,
        })
    }
}

impl fmt::Debug for WorkflowIsolationAttestation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("WorkflowIsolationAttestation")
            .field("capability_id", &"[REDACTED]")
            .field("identity", &self.identity)
            .field("backend_version", &self.backend_version)
            .field("policy_version", &self.policy_version)
            .field("broker_generation", &self.broker_generation)
            .field("policy_digest", &self.policy_digest)
            .field("enforcement", &self.enforcement)
            .field("proven_guarantees", &self.proven_guarantees)
            .finish()
    }
}

pub(super) fn valid_policy_digest(value: &str) -> bool {
    let Some(hex) = value.strip_prefix("sha256:") else {
        return false;
    };
    hex.len() == 64
        && hex
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

#[derive(Clone, PartialEq, Eq)]
pub struct WorkflowIsolationCapability {
    pub(super) attestation: WorkflowIsolationAttestation,
    pub(super) policy: WorkflowIsolationPolicy,
}

impl WorkflowIsolationCapability {
    pub fn identity(&self) -> &WorkflowDeliveryIdentity {
        &self.attestation.identity
    }

    pub fn enforcement(&self) -> WorkflowIsolationEnforcement {
        self.attestation.enforcement
    }

    pub fn capability_id(&self) -> &str {
        &self.attestation.capability_id
    }

    pub fn backend_version(&self) -> &str {
        &self.attestation.backend_version
    }

    pub fn policy_version(&self) -> &str {
        &self.attestation.policy_version
    }

    pub fn broker_generation(&self) -> u64 {
        self.attestation.broker_generation
    }

    pub fn policy_digest(&self) -> &str {
        &self.attestation.policy_digest
    }

    pub fn proven_guarantees(&self) -> &BTreeSet<WorkflowIsolationGuarantee> {
        &self.attestation.proven_guarantees
    }

    pub fn policy(&self) -> &WorkflowIsolationPolicy {
        &self.policy
    }
}

impl fmt::Debug for WorkflowIsolationCapability {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("WorkflowIsolationCapability")
            .field("capability_id", &"[REDACTED]")
            .field("identity", self.identity())
            .field("backend_version", &self.backend_version())
            .field("policy_version", &self.policy_version())
            .field("broker_generation", &self.broker_generation())
            .field("policy_digest", &self.policy_digest())
            .field("enforcement", &self.enforcement())
            .field("policy", &self.policy)
            .finish()
    }
}

pub fn attest_workflow_isolation(
    broker: &dyn WorkflowIsolationBroker,
    identity: &WorkflowDeliveryIdentity,
    policy: &WorkflowIsolationPolicy,
) -> Result<WorkflowIsolationCapability, WorkflowIsolationError> {
    let attestation = broker.attest(identity, &policy)?;
    if &attestation.identity != identity {
        return Err(WorkflowIsolationError::AttestationIdentityMismatch);
    }
    if attestation.policy_version != policy.version()
        || attestation.policy_digest != policy.digest()
    {
        return Err(WorkflowIsolationError::AttestationPolicyMismatch);
    }
    Ok(WorkflowIsolationCapability {
        attestation,
        policy: policy.clone(),
    })
}
