pub(in crate::live::sessions::actor) fn trace_native_variant(
    native_session_id: &str,
    config_id: &str,
    requested: &str,
    resolved: &str,
) {
    if requested == resolved {
        return;
    }

    tracing::debug!(
        native_session_id,
        config_id,
        requested,
        resolved,
        "[model-switch] resolved bare model variant from live ACP config"
    );
}

pub(in crate::live::sessions::actor) fn trace_session_variant(
    session_id: &str,
    config_id: &str,
    requested: &str,
    resolved: &str,
) {
    if requested == resolved {
        return;
    }

    tracing::debug!(
        session_id,
        config_id,
        requested,
        resolved,
        "[model-switch] resolved bare model variant from live ACP config"
    );
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::live::sessions::actor) enum ConfigFailureStage {
    #[allow(dead_code)] // AH-CLIPPY-2: flagged dead by lint wiring 2026-08-27; owner deletes or revives
    RequestedModel,
    #[allow(dead_code)] // AH-CLIPPY-2: flagged dead by lint wiring 2026-08-27; owner deletes or revives
    RequestedMode,
    DirectModelSetter,
    #[allow(dead_code)] // AH-CLIPPY-2: flagged dead by lint wiring 2026-08-27; owner deletes or revives
    InitialLiveConfig,
    RestoreLiveConfig,
    PostPreferencesLiveConfig,
}

impl ConfigFailureStage {
    pub(in crate::live::sessions::actor) const fn as_str(self) -> &'static str {
        match self {
            Self::RequestedModel => "requested_model",
            Self::RequestedMode => "requested_mode",
            Self::DirectModelSetter => "direct_model_setter",
            Self::InitialLiveConfig => "initial_live_config",
            Self::RestoreLiveConfig => "restore_live_config",
            Self::PostPreferencesLiveConfig => "post_preferences_live_config",
        }
    }

    const fn failure_class(self) -> &'static str {
        match self {
            Self::RequestedModel | Self::RequestedMode | Self::DirectModelSetter => {
                "acp_config_apply_failed"
            }
            Self::InitialLiveConfig | Self::RestoreLiveConfig | Self::PostPreferencesLiveConfig => {
                "live_config_state_failed"
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::live::sessions::actor) struct ConfigFailureProjection {
    pub failure_class: &'static str,
    pub failure_stage: &'static str,
}

/// Projects any provider/store error onto a closed diagnostic vocabulary.
/// The input is deliberately never formatted: ACP error Display includes
/// provider message/data, and startup diagnostics must remain payload-free.
pub(in crate::live::sessions::actor) fn fixed_config_failure<E>(
    _error: &E,
    stage: ConfigFailureStage,
) -> ConfigFailureProjection {
    ConfigFailureProjection {
        failure_class: stage.failure_class(),
        failure_stage: stage.as_str(),
    }
}

#[cfg(test)]
mod tests {
    use super::{fixed_config_failure, ConfigFailureStage};

    struct ProviderSentinel;

    impl std::fmt::Display for ProviderSentinel {
        fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("provider-response-secret")
        }
    }

    #[test]
    fn config_failure_projection_never_formats_provider_material() {
        let projection =
            fixed_config_failure(&ProviderSentinel, ConfigFailureStage::DirectModelSetter);
        let diagnostic = format!("{projection:?}");
        assert_eq!(projection.failure_class, "acp_config_apply_failed");
        assert_eq!(projection.failure_stage, "direct_model_setter");
        assert!(!diagnostic.contains("provider-response-secret"));
    }
}
