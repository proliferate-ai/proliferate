//! Bounded diagnostics producer used only by Desktop-owned AnyHarness and Worker processes.
//!
//! Absence of Desktop's inherited bridge is authoritative: no producer state,
//! background task, fallback writer, or network client is created.

use std::{borrow::Cow, time::Duration};

use proliferate_diagnostics_protocol::v1::types::{
    ArgumentValueV1, DetailedKindV1, SeverityV1, StandardStreamV1,
};

pub mod bridge;
mod fallback;
mod producer;
mod tracing_layer;

pub use bridge::activation::{
    take_desktop_activation, BundledDesktopDiagnosticsBootstrap, CollectorGenerationHandle,
    DesktopDiagnosticsActivation, DesktopDiagnosticsBootstrap, DesktopDiagnosticsDegradedBootstrap,
    InitialCollectorState, UnavailableClassification,
};
#[cfg(debug_assertions)]
pub use bridge::activation::{
    DevEnvDiagnosticsBootstrap, DEV_CAPABILITY_ENV, DEV_COLLECTOR_BOOT_ID_ENV, DEV_ENDPOINT_ENV,
    DEV_ENV_PATH_ENV,
};
pub use fallback::{
    parse_fallback_record_line, FallbackReason, FallbackRecordV1, FALLBACK_SCHEMA,
    FALLBACK_SEGMENTS, FALLBACK_SEGMENT_BYTES, FALLBACK_TOTAL_BYTES,
};
pub use producer::status::{
    BoundedLossCounters, ProducerCollectorState, ProducerFailureClassification,
    ProducerStatusSnapshot,
};
pub use producer::{DiagnosticsProducerGuard, DiagnosticsProducerHandle, DropClassification};
pub use tracing_layer::{
    DiagnosticsTracingLayer, ResolvedRecordName, TargetMapping, TargetMappingConfig,
};

/// Producer identity fixed by the binary installing this adapter.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiagnosticsComponent {
    AnyHarness,
    DesktopWorker,
}

impl DiagnosticsComponent {
    pub(crate) fn protocol_component(
        self,
    ) -> proliferate_diagnostics_protocol::v1::types::ComponentV1 {
        use proliferate_diagnostics_protocol::v1::types::ComponentV1;
        match self {
            Self::AnyHarness => ComponentV1::Anyharness,
            Self::DesktopWorker => ComponentV1::DesktopWorker,
        }
    }

    pub(crate) fn protocol_source(self) -> proliferate_diagnostics_protocol::v1::types::SourceV1 {
        use proliferate_diagnostics_protocol::v1::types::SourceV1;
        match self {
            Self::AnyHarness => SourceV1::Anyharness,
            Self::DesktopWorker => SourceV1::Worker,
        }
    }

    pub(crate) fn wire_name(self) -> bridge::wire::WireComponent {
        match self {
            Self::AnyHarness => bridge::wire::WireComponent::Anyharness,
            Self::DesktopWorker => bridge::wire::WireComponent::DesktopWorker,
        }
    }
}

/// Local-purpose privacy classification for a caller-supplied argument.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum DiagnosticPrivacy {
    Operational,
    CustomerContent,
    Sensitive,
}

pub struct DiagnosticArgument {
    pub name: Cow<'static, str>,
    pub privacy: DiagnosticPrivacy,
    pub value: ArgumentValueV1,
}

#[derive(Default, Clone, Debug, PartialEq, Eq)]
pub struct DiagnosticCorrelation {
    pub operation_id: Option<String>,
    pub parent_operation_id: Option<String>,
    pub trace_id: Option<String>,
    pub workspace_id: Option<String>,
    pub session_id: Option<String>,
    pub turn_id: Option<String>,
    pub item_id: Option<String>,
    pub request_id: Option<String>,
    pub target_id: Option<String>,
    pub prompt_id: Option<String>,
    pub workflow_id: Option<String>,
}

pub struct DetailedDiagnosticInput {
    pub name: Cow<'static, str>,
    pub severity: SeverityV1,
    pub kind: DetailedKindV1,
    pub message: Option<String>,
    pub privacy: DiagnosticPrivacy,
    pub arguments: Vec<DiagnosticArgument>,
    pub correlation: DiagnosticCorrelation,
    pub error_classification: Option<Cow<'static, str>>,
    pub stream: Option<StandardStreamV1>,
    pub dropped_count: Option<u64>,
    pub milestone: Option<Cow<'static, str>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EmitDisposition {
    Admitted,
    Dropped(DropClassification),
    Inactive,
}

pub struct DiagnosticsInstallation {
    pub handle: DiagnosticsProducerHandle,
    pub layer: DiagnosticsTracingLayer,
    pub guard: DiagnosticsProducerGuard,
}

#[derive(Debug, thiserror::Error)]
pub enum InstallError {
    #[error("desktop diagnostics bootstrap is unusable")]
    BootstrapInvalid,
    #[error("desktop diagnostics worker unavailable")]
    WorkerUnavailable,
}

pub fn install_desktop_producer(
    component: DiagnosticsComponent,
    activation: BundledDesktopDiagnosticsBootstrap,
    release: &str,
    environment: &str,
) -> Result<DiagnosticsInstallation, InstallError> {
    producer::install(component, activation, release, environment)
}

impl DiagnosticsProducerHandle {
    pub fn try_emit_detailed(&self, input: DetailedDiagnosticInput) -> EmitDisposition {
        self.try_emit(input)
    }

    pub fn new_operation_context(&self, mut seed: DiagnosticCorrelation) -> DiagnosticCorrelation {
        if seed.operation_id.is_none() {
            seed.operation_id = Some(uuid::Uuid::new_v4().to_string());
        }
        seed
    }

    pub fn child_operation_context(
        &self,
        parent: &DiagnosticCorrelation,
        mut seed: DiagnosticCorrelation,
    ) -> DiagnosticCorrelation {
        seed.parent_operation_id = parent.operation_id.clone();
        seed.operation_id = Some(uuid::Uuid::new_v4().to_string());
        seed.inherit_missing(parent);
        seed
    }
}

impl DiagnosticCorrelation {
    fn inherit_missing(&mut self, parent: &Self) {
        macro_rules! inherit {
            ($field:ident) => {
                if self.$field.is_none() {
                    self.$field = parent.$field.clone();
                }
            };
        }
        inherit!(trace_id);
        inherit!(workspace_id);
        inherit!(session_id);
        inherit!(turn_id);
        inherit!(item_id);
        inherit!(request_id);
        inherit!(target_id);
        inherit!(prompt_id);
        inherit!(workflow_id);
    }
}

impl DiagnosticsProducerGuard {
    pub async fn shutdown(self, deadline: Duration) -> ProducerStatusSnapshot {
        self.shutdown_inner(deadline).await
    }
}
