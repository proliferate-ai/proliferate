//! Pure, purpose-specific second-pass scrubbing for consented support data.
//!
//! This module owns no I/O or package policy. Callers provide already-owned
//! candidates plus an optional trusted home prefix; results carry all
//! fixed-class redaction, omission, and truncation accounting needed by the
//! later assembler.

use std::fmt;

use serde::Serialize;

use super::schema::enums::SupportEvidenceSourceV1;
use super::schema::model::common::SupportJsonValueV1;

mod accounting;
mod patterns;
mod record;
mod text;
mod value;

pub use accounting::SupportScrubAccounting;

/// The semantic role of one caller-supplied string.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SupportTextKind {
    /// Ordinary metadata, capped at 4,096 UTF-8 bytes.
    Generic,
    /// Customer detail such as prompts, output, paths, or provider bodies,
    /// capped at 16,384 UTF-8 bytes.
    Content,
    /// A correlation or identity field, capped at 128 UTF-8 bytes and never
    /// truncated into a colliding value.
    Identifier,
    /// A closed or low-cardinality name, capped at 128 UTF-8 bytes.
    Name,
    /// A semantic timestamp, capped at 128 UTF-8 bytes.
    Timestamp,
    /// An explicit hash or commit value, capped at 128 UTF-8 bytes.
    Hash,
}

/// A fatal inability to prove a mandatory value safe within fixed bounds.
///
/// Variants deliberately carry no caller data, so `Display` and `Debug` can
/// never reproduce a secret canary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SupportScrubError {
    TraversalLimit,
    InvalidValue,
    AccountingOverflow,
    InvalidConfiguration,
}

impl fmt::Display for SupportScrubError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::TraversalLimit => "support value exceeds bounded traversal",
            Self::InvalidValue => "support value is structurally invalid",
            Self::AccountingOverflow => "support scrub accounting overflow",
            Self::InvalidConfiguration => "support scrubber configuration is invalid",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for SupportScrubError {}

/// One mandatory scrubbed value and its exact accounting.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportScrubbed<T> {
    pub value: T,
    pub accounting: SupportScrubAccounting,
}

/// One optional unit. `None` means the smallest trustworthy unit was omitted
/// and the reason is present in `accounting.omissions`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportOptionalScrubbed<T> {
    pub value: Option<T>,
    pub accounting: SupportScrubAccounting,
}

/// Stateless scrubber apart from an optional, caller-provided home prefix.
#[derive(Default)]
pub struct SupportExportScrubber {
    home_directory: Option<String>,
}

impl SupportExportScrubber {
    /// Construct a pure scrubber. The home prefix is never discovered through
    /// I/O and is retained only for exact path-prefix normalization.
    pub fn new(home_directory: Option<String>) -> Result<Self, SupportScrubError> {
        let home_directory = match home_directory {
            Some(home) => {
                if home.is_empty() || home.len() > super::schema::limits::GENERIC_STRING_BYTES {
                    return Err(SupportScrubError::InvalidConfiguration);
                }
                let trimmed = home.trim_end_matches(|character| matches!(character, '/' | '\\'));
                if trimmed.is_empty() {
                    return Err(SupportScrubError::InvalidConfiguration);
                }
                Some(trimmed.to_owned())
            }
            None => None,
        };
        Ok(Self { home_directory })
    }

    /// Scrub one mandatory bounded projected value. Invalid depth, numbers,
    /// or ambiguous object shape fail with a secret-free typed error.
    pub fn scrub_value(
        &self,
        value: SupportJsonValueV1,
        source: SupportEvidenceSourceV1,
    ) -> Result<SupportScrubbed<SupportJsonValueV1>, SupportScrubError> {
        value::scrub_mandatory(self, value, source)
    }

    /// Scrub one optional projected value, omitting only that value if its
    /// bounded traversal cannot be proved.
    pub fn scrub_optional_value(
        &self,
        value: SupportJsonValueV1,
        source: SupportEvidenceSourceV1,
    ) -> Result<SupportOptionalScrubbed<SupportJsonValueV1>, SupportScrubError> {
        value::scrub_optional(self, value, source)
    }
}

impl fmt::Debug for SupportExportScrubber {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SupportExportScrubber")
            .field(
                "home_directory",
                &self.home_directory.as_ref().map(|_| "[configured]"),
            )
            .finish()
    }
}

#[cfg(test)]
mod tests;
