use super::policy::{canonical_control_endpoint, REQUIRED_GUARANTEES};
use super::*;
use crate::process_env::test_scoped_workflow_agent_env;
use std::path::PathBuf;

fn identity(run_id: &str) -> WorkflowDeliveryIdentity {
    WorkflowDeliveryIdentity::try_new(
        run_id,
        Some("sha256:1111111111111111111111111111111111111111111111111111111111111111"),
        Some("sha256:2222222222222222222222222222222222222222222222222222222222222222"),
        Some(7),
    )
    .expect("identity")
}

fn guarantees() -> Vec<WorkflowIsolationGuarantee> {
    REQUIRED_GUARANTEES.to_vec()
}

#[test]
fn default_broker_fails_closed() {
    let error = attest_workflow_isolation(
        &UnavailableWorkflowIsolationBroker,
        &identity("run-1"),
        &test_isolation_policy(),
    )
    .expect_err("missing platform broker must reject");
    assert!(matches!(error, WorkflowIsolationError::Unavailable));
    assert_eq!(error.code(), WORKFLOW_AGENT_ISOLATION_UNAVAILABLE);
}

enum AttestationTamper {
    Identity,
    Policy,
}

struct TamperedBroker(AttestationTamper);

#[async_trait::async_trait]
impl WorkflowIsolationBroker for TamperedBroker {
    fn attest(
        &self,
        requested_identity: &WorkflowDeliveryIdentity,
        policy: &WorkflowIsolationPolicy,
    ) -> Result<WorkflowIsolationAttestation, WorkflowIsolationError> {
        let attested_identity = match self.0 {
            AttestationTamper::Identity => identity("different-run"),
            AttestationTamper::Policy => requested_identity.clone(),
        };
        let policy_digest = match self.0 {
            AttestationTamper::Identity => policy.digest(),
            AttestationTamper::Policy => {
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                    .to_string()
            }
        };
        WorkflowIsolationAttestation::new(
            "cap-1",
            attested_identity,
            "test-backend-v1",
            policy.version(),
            1,
            policy_digest,
            WorkflowIsolationEnforcement::PlatformSandbox,
            guarantees(),
        )
    }

    fn spawn_agent(
        &self,
        _capability: &WorkflowIsolationCapability,
        _request: WorkflowAgentLaunchRequest,
    ) -> Result<BrokeredWorkflowAgentProcess, WorkflowIsolationError> {
        unreachable!()
    }

    fn authorize_executable(
        &self,
        capability: &WorkflowIsolationCapability,
        identity: &WorkflowProcessIdentity,
        requested_program: &std::path::Path,
    ) -> Result<WorkflowExecutableAuthorization, WorkflowIsolationError> {
        WorkflowExecutableAuthorization::try_new(
            identity.clone(),
            requested_program.to_path_buf(),
            requested_program.to_path_buf(),
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            capability.identity().execution_generation(),
            capability.broker_generation(),
        )
    }

    fn bind_local_gateway(
        &self,
        _capability: &WorkflowIsolationCapability,
        _identity: &WorkflowProcessIdentity,
    ) -> Result<TrustedLocalGatewayBinding, WorkflowIsolationError> {
        unreachable!()
    }

    async fn run_command(
        &self,
        _capability: &WorkflowIsolationCapability,
        _request: WorkflowCommandRequest,
    ) -> Result<WorkflowCommandOutput, WorkflowIsolationError> {
        unreachable!()
    }

    async fn cancel_process_group(
        &self,
        _capability: &WorkflowIsolationCapability,
        _process_group: &WorkflowProcessGroup,
    ) -> Result<(), WorkflowIsolationError> {
        unreachable!()
    }

    async fn cancel_run(
        &self,
        _capability: &WorkflowIsolationCapability,
    ) -> Result<(), WorkflowIsolationError> {
        unreachable!()
    }

    fn notify_step_transition(
        &self,
        _capability: &WorkflowIsolationCapability,
    ) -> Result<(), WorkflowIsolationError> {
        unreachable!()
    }
}

#[test]
fn tampered_attestation_fails_closed() {
    let error = attest_workflow_isolation(
        &TamperedBroker(AttestationTamper::Identity),
        &identity("run-1"),
        &test_isolation_policy(),
    )
    .expect_err("mismatched attestation must reject");
    assert!(matches!(
        error,
        WorkflowIsolationError::AttestationIdentityMismatch
    ));
}

#[test]
fn mismatched_runtime_policy_fails_closed() {
    let error = attest_workflow_isolation(
        &TamperedBroker(AttestationTamper::Policy),
        &identity("run-1"),
        &test_isolation_policy(),
    )
    .expect_err("arbitrary adapter policy digest must reject");
    assert!(matches!(
        error,
        WorkflowIsolationError::AttestationPolicyMismatch
    ));
}

#[test]
fn policy_digest_binds_exact_workspace_roots_and_control_origins() {
    let root = std::env::temp_dir().join(format!("workflow-policy-root-{}", uuid::Uuid::new_v4()));
    let workspace_a = root.join("workspace-a");
    let workspace_b = root.join("workspace-b");
    std::fs::create_dir_all(&workspace_a).expect("workspace a");
    std::fs::create_dir_all(&workspace_b).expect("workspace b");
    let make = |workspace: PathBuf, endpoint: &str| {
        WorkflowIsolationPolicy::try_new(
            [PathBuf::from("/var/empty/anyharness-runtime-private")],
            [endpoint.to_string()],
            [workspace],
            Vec::new(),
        )
        .expect("policy")
    };
    let policy_a = make(workspace_a, "http://127.0.0.1:8457");
    let policy_b = make(workspace_b, "http://127.0.0.1:8457");
    let policy_other_control = make(root.clone(), "http://127.0.0.1:9457");
    assert_ne!(policy_a.digest(), policy_b.digest());
    assert_ne!(policy_a.digest(), policy_other_control.digest());
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn control_endpoint_policy_rejects_redirectable_or_ambiguous_origins() {
    for endpoint in [
        "https://127.0.0.1:8457",
        "http://localhost:8457",
        "http://127.0.0.1",
        "http://127.0.0.1:8457/control",
        "http://user@127.0.0.1:8457",
        "http://127.0.0.1:8457/?token=secret",
        "http://127.0.0.1:8457/#fragment",
    ] {
        assert!(
            canonical_control_endpoint(endpoint.to_string()).is_err(),
            "unsafe control origin accepted: {endpoint}"
        );
    }
    assert_eq!(
        canonical_control_endpoint("http://127.0.0.1:8457".to_string()).unwrap(),
        "http://127.0.0.1:8457"
    );
}

#[test]
fn process_identity_constructors_reject_blank_subjects_and_invalid_attempts() {
    let delivery = identity("run-strict-subject");
    assert!(
        WorkflowProcessIdentity::try_session(delivery.clone(), "", "session-1", "/tmp").is_err()
    );
    assert!(
        WorkflowProcessIdentity::try_session(delivery.clone(), "main", " session-1", "/tmp")
            .is_err()
    );
    assert!(WorkflowProcessIdentity::try_step(
        delivery.clone(),
        "root::step",
        0,
        WorkflowCommandKind::Shell,
        "/tmp",
    )
    .is_err());
    assert!(WorkflowProcessIdentity::try_lane_merge(delivery.clone(), "", "/tmp").is_err());
    assert!(
        WorkflowProcessIdentity::try_materialization(delivery, "", "/tmp", "/tmp/target").is_err()
    );
}

#[test]
fn delivery_and_process_identities_reject_unbounded_or_path_like_tokens() {
    for invalid_run_id in [
        " run-1".to_string(),
        "run/other".to_string(),
        "run\\other".to_string(),
        "run\nother".to_string(),
        "run-☃".to_string(),
        "run.alias".to_string(),
        "r".repeat(129),
    ] {
        assert!(WorkflowDeliveryIdentity::try_new(
            invalid_run_id,
            Some("sha256:1111111111111111111111111111111111111111111111111111111111111111"),
            Some("sha256:2222222222222222222222222222222222222222222222222222222222222222"),
            Some(1),
        )
        .is_err());
    }

    let delivery = identity("run-bounded-identities");
    for invalid in [
        "slot/other".to_string(),
        "slot\nother".to_string(),
        "slot-☃".to_string(),
        "s".repeat(129),
    ] {
        assert!(WorkflowProcessIdentity::try_session(
            delivery.clone(),
            invalid,
            "session-1",
            "/tmp",
        )
        .is_err());
    }
    assert!(WorkflowProcessIdentity::try_materialization(
        delivery.clone(),
        "lane.alias",
        "/tmp",
        "/tmp/target",
    )
    .is_err());
    for invalid_step in [
        "root/step".to_string(),
        "root::step\nforged".to_string(),
        "root::☃".to_string(),
        "s".repeat(513),
    ] {
        assert!(WorkflowProcessIdentity::try_step(
            delivery.clone(),
            invalid_step,
            1,
            WorkflowCommandKind::Shell,
            "/tmp",
        )
        .is_err());
    }
}

#[test]
fn agent_json_cannot_supply_trusted_activation() {
    let value = serde_json::json!({
        "providerDefinitionId": "slack",
        "toolName": "post_message",
        "arguments": {"text": "hello"},
        "activationId": "agent-forged"
    });
    assert!(serde_json::from_value::<AgentGatewayInvocation>(value).is_err());
}

#[test]
fn local_binding_has_no_bearer_or_header_surface() {
    let binding = TrustedLocalGatewayBinding::try_new(
        "http://127.0.0.1:43891/mcp",
        "session-1",
        7,
        1,
        "local-session-capability-secret",
    )
    .expect("valid local binding");
    assert_eq!(binding.endpoint(), "http://127.0.0.1:43891/mcp");
    assert!(TrustedLocalGatewayBinding::try_new(
        "https://cloud.test/mcp",
        "session-1",
        7,
        1,
        "local-session-capability-secret"
    )
    .is_err());
    for endpoint in [
        "http://localhost:43891/mcp",
        "http://127.0.0.1/mcp",
        "http://127.0.0.1:0/mcp",
        "http://user@127.0.0.1:43891/mcp",
        "http://127.0.0.1:43891/other",
        "http://127.0.0.1:43891/mcp?token=secret",
        "http://127.0.0.1:43891/mcp#redirect",
    ] {
        assert!(
            TrustedLocalGatewayBinding::try_new(
                endpoint,
                "session-1",
                7,
                1,
                "local-session-capability-secret"
            )
            .is_err(),
            "unsafe local binding endpoint accepted: {endpoint}"
        );
    }
    for (session_id, capability) in [
        ("session/other".to_string(), "capability".to_string()),
        ("session-☃".to_string(), "capability".to_string()),
        ("s".repeat(129), "capability".to_string()),
        ("session-1".to_string(), "capability\nforged".to_string()),
        ("session-1".to_string(), "c".repeat(4_097)),
    ] {
        assert!(TrustedLocalGatewayBinding::try_new(
            "http://127.0.0.1:43891/mcp",
            session_id,
            7,
            1,
            capability,
        )
        .is_err());
    }
    let debug = format!("{binding:?}");
    assert!(!debug.contains("local-session-capability-secret"));
}

#[test]
fn opaque_broker_handles_are_redacted_from_debug_output() {
    let delivery = identity("run-debug-redaction");
    let capability = test_isolation_capability(delivery.clone());
    assert!(!format!("{capability:?}").contains("test-capability"));
    assert!(!format!("{:?}", capability.attestation).contains("test-capability"));

    let process_identity =
        WorkflowProcessIdentity::try_session(delivery.clone(), "main", "session-1", "/tmp")
            .expect("identity");
    let group = WorkflowProcessGroup::try_new(
        "process-group-secret-canary",
        process_identity.clone(),
        delivery.execution_generation(),
        capability.broker_generation(),
    )
    .expect("process group");
    assert!(!format!("{group:?}").contains("process-group-secret-canary"));
    let activation =
        TrustedActivationContext::new("activation-secret-canary", process_identity.clone())
            .expect("activation");
    assert!(!format!("{activation:?}").contains("activation-secret-canary"));

    let request = WorkflowAgentLaunchRequest {
        identity: process_identity,
        program: "/usr/bin/agent".into(),
        args: Vec::new(),
        cwd: "/tmp".into(),
        env: test_scoped_workflow_agent_env(
            "claude",
            [(
                "ANTHROPIC_AUTH_TOKEN".to_string(),
                "provider-secret-canary".to_string(),
            )],
        ),
        resources: WorkflowAgentResourceLimits::phase_a_maximums(),
    };
    let debug = format!("{request:?}");
    assert!(debug.contains("ANTHROPIC_AUTH_TOKEN"));
    assert!(!debug.contains("provider-secret-canary"));
}

#[test]
fn attestation_rejects_missing_proofs_and_noncanonical_policy_digest() {
    let error = WorkflowIsolationAttestation::new(
        "cap-1",
        identity("run-1"),
        "test-backend-v1",
        test_isolation_policy().version(),
        1,
        "sha256:ABC",
        WorkflowIsolationEnforcement::PlatformSandbox,
        [WorkflowIsolationGuarantee::WorkspaceReadWrite],
    )
    .expect_err("partial proof is not isolation");
    assert!(matches!(error, WorkflowIsolationError::InvalidAttestation));

    let without_environment_denial = guarantees()
        .into_iter()
        .filter(|guarantee| {
            *guarantee != WorkflowIsolationGuarantee::RuntimePrivateEnvironmentDenied
        })
        .collect::<Vec<_>>();
    assert!(WorkflowIsolationAttestation::new(
        "cap-1",
        identity("run-1"),
        "test-backend-v1",
        test_isolation_policy().version(),
        1,
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        WorkflowIsolationEnforcement::PlatformSandbox,
        without_environment_denial,
    )
    .is_err());
}
