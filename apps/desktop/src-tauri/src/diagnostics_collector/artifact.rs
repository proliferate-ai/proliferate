use proliferate_diagnostics_protocol::v1::types::{ExportPurposeV1, ExportRequestV1};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DiagnosticsArtifactKind {
    Customer,
    InternalDogfood,
}

impl DiagnosticsArtifactKind {
    pub(crate) const fn current() -> Self {
        if cfg!(feature = "internal-diagnostics-artifact") {
            Self::InternalDogfood
        } else {
            Self::Customer
        }
    }

    pub(crate) fn authorize_external_export(
        self,
        request: &ExportRequestV1,
    ) -> Result<(), &'static str> {
        match request.purpose {
            ExportPurposeV1::Support => Err("support_authorization_required"),
            ExportPurposeV1::InternalDogfood if self == Self::InternalDogfood => Ok(()),
            ExportPurposeV1::InternalDogfood => Err("artifact_not_internal"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proliferate_diagnostics_protocol::v1::{
        limits::CURRENT_SCHEMA_VERSION,
        types::{ExportRequestV1, RecordsFilterV1},
    };

    fn request(purpose: ExportPurposeV1) -> ExportRequestV1 {
        ExportRequestV1 {
            schema_version: CURRENT_SCHEMA_VERSION,
            purpose,
            support_authorization_id: match purpose {
                ExportPurposeV1::Support => Some("one-use-consent".to_string()),
                ExportPurposeV1::InternalDogfood => None,
            },
            filters: RecordsFilterV1 {
                source_time_from: None,
                source_time_to: None,
                components: Vec::new(),
                record_classes: Vec::new(),
                severities: Vec::new(),
                names: Vec::new(),
                outcomes: Vec::new(),
                operation_id: None,
                parent_operation_id: None,
                trace_id: None,
                workspace_id: None,
                session_id: None,
                turn_id: None,
                item_id: None,
                request_id: None,
                target_id: None,
                prompt_id: None,
                workflow_id: None,
                error_classification: None,
            },
            record_limit: 1,
            byte_limit: 1024,
            include_health: true,
        }
    }

    #[test]
    fn customer_artifact_rejects_every_external_export_purpose() {
        let customer = DiagnosticsArtifactKind::Customer;
        assert!(customer
            .authorize_external_export(&request(ExportPurposeV1::Support))
            .is_err());
        assert!(customer
            .authorize_external_export(&request(ExportPurposeV1::InternalDogfood))
            .is_err());
    }

    #[test]
    fn injected_internal_artifact_allows_only_internal_export() {
        let internal = DiagnosticsArtifactKind::InternalDogfood;
        assert!(internal
            .authorize_external_export(&request(ExportPurposeV1::InternalDogfood))
            .is_ok());
        assert!(internal
            .authorize_external_export(&request(ExportPurposeV1::Support))
            .is_err());
    }
}
