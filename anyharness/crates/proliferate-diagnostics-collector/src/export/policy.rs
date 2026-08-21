//! What a build is allowed to export, decided at compile time.
//!
//! This is the whole privacy control for the export leg, and it is one
//! constant rather than a configuration value on purpose: a customer build
//! physically cannot be told to export the detailed class, because the check
//! that would have to be relaxed is not reachable from any input.
//!
//! Two fences consult it, not one. [`ExportPolicy::admits`] runs on the ingest
//! path before a record can enter the export queue (`handle.rs`), and again
//! inside the encoder (`otlp.rs`) before a record can become a wire payload.
//! The second is redundant today by construction; it exists so that a future
//! call site that finds another way into the encoder still cannot smuggle a
//! detailed record past the first check.

use proliferate_diagnostics_protocol::v1::types::{
    PrivacyClassificationV1, ProducerRecordV1, RecordClassV1,
};

/// The literal a packaged binary is grepped for by the desktop release job,
/// and the line `--print-export-policy` writes. Exactly one of the two is
/// compiled into any given binary, so its presence is a positive statement
/// about what that binary can do rather than an absence proof about strings.
#[cfg(test)]
pub(crate) const POLICY_MARKER_PREFIX: &str = "PROLIFERATE_EXPORT_POLICY=";

// Both variants exist in both builds by design: the policy is selected by
// `cfg`, so exactly one is ever constructed and the other is still needed for
// the tables, the tests, and the reader.
#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ExportPolicy {
    /// Customer builds. Only `record_class == lifecycle` leaves the machine,
    /// and only when every field on it is `operational`.
    LifecycleOnly,
    /// Internal/dogfood builds. Everything except `secret`, which ingest has
    /// already rejected and the encoder refuses again.
    All,
}

/// Customer builds.
#[cfg(not(feature = "internal-dogfood-export"))]
pub(crate) const EXPORT_POLICY: ExportPolicy = ExportPolicy::LifecycleOnly;

/// Internal/dogfood builds.
#[cfg(feature = "internal-dogfood-export")]
pub(crate) const EXPORT_POLICY: ExportPolicy = ExportPolicy::All;

/// The one line `--print-export-policy` writes, with the marker prefix so the
/// same literal is both the runtime answer and the packaged-binary evidence.
#[cfg(not(feature = "internal-dogfood-export"))]
pub(crate) const EXPORT_POLICY_MARKER: &str = "PROLIFERATE_EXPORT_POLICY=lifecycle_only";

#[cfg(feature = "internal-dogfood-export")]
pub(crate) const EXPORT_POLICY_MARKER: &str = "PROLIFERATE_EXPORT_POLICY=all";

impl ExportPolicy {
    pub(crate) const fn name(self) -> &'static str {
        match self {
            Self::LifecycleOnly => "lifecycle_only",
            Self::All => "all",
        }
    }

    /// Whether this build may export the class at all. Checked on the ingest
    /// path, where the answer is known without deserializing anything.
    ///
    /// A refused class is not a loss and is not counted as one: the record was
    /// accepted, retained, and is queryable locally. Nothing was dropped, the
    /// build simply does not export that class.
    pub(crate) const fn admits_class(self, class: RecordClassV1) -> bool {
        match self {
            Self::All => true,
            Self::LifecycleOnly => matches!(class, RecordClassV1::Lifecycle),
        }
    }

    /// Whether this build may export a field or record at this privacy level.
    ///
    /// `secret` is refused under every policy; ingest already rejects it
    /// (`validation.rs`), so this is the second fence rather than a new path.
    /// A customer build narrows further to `operational` only: lifecycle
    /// records should already be operational, but "should already be" is not
    /// an invariant.
    pub(crate) const fn admits_privacy(self, privacy: PrivacyClassificationV1) -> bool {
        match self {
            Self::All => !matches!(privacy, PrivacyClassificationV1::Secret),
            Self::LifecycleOnly => matches!(privacy, PrivacyClassificationV1::Operational),
        }
    }

    /// The encoder's whole-record verdict.
    pub(crate) fn admits(self, record: &ProducerRecordV1) -> bool {
        self.admits_class(record.record_class) && self.admits_privacy(record.privacy)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_customer_build_exports_lifecycle_only() {
        let policy = ExportPolicy::LifecycleOnly;
        assert!(policy.admits_class(RecordClassV1::Lifecycle));
        assert!(!policy.admits_class(RecordClassV1::Detailed));
    }

    /// Detailed records are the only payload in the protocol that can carry
    /// free text (`DetailedDiagnosticV1` owns `message`, `stream`, and
    /// `milestone`). Dropping the class drops the entire free-text surface,
    /// which is why this is the privacy control and not a volume control.
    #[test]
    fn a_dogfood_build_exports_both_classes() {
        let policy = ExportPolicy::All;
        assert!(policy.admits_class(RecordClassV1::Lifecycle));
        assert!(policy.admits_class(RecordClassV1::Detailed));
    }

    #[test]
    fn no_policy_admits_a_secret_record() {
        for policy in [ExportPolicy::LifecycleOnly, ExportPolicy::All] {
            assert!(!policy.admits_privacy(PrivacyClassificationV1::Secret));
        }
    }

    #[test]
    fn a_customer_build_narrows_to_operational_while_dogfood_does_not() {
        for privacy in [
            PrivacyClassificationV1::CustomerContent,
            PrivacyClassificationV1::Sensitive,
        ] {
            assert!(!ExportPolicy::LifecycleOnly.admits_privacy(privacy));
            assert!(ExportPolicy::All.admits_privacy(privacy));
        }
        assert!(ExportPolicy::LifecycleOnly.admits_privacy(PrivacyClassificationV1::Operational));
    }

    /// The release job greps the packaged binary for this literal and runs the
    /// packaged collector to read the same one back, so the two must agree and
    /// exactly one must be compiled in.
    #[test]
    fn the_marker_states_the_compiled_policy() {
        assert_eq!(
            EXPORT_POLICY_MARKER,
            format!("{POLICY_MARKER_PREFIX}{}", EXPORT_POLICY.name())
        );
        #[cfg(not(feature = "internal-dogfood-export"))]
        assert_eq!(EXPORT_POLICY, ExportPolicy::LifecycleOnly);
        #[cfg(feature = "internal-dogfood-export")]
        assert_eq!(EXPORT_POLICY, ExportPolicy::All);
    }
}
