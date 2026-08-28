use std::borrow::Cow;

use super::super::schema::enums::{
    SupportEvidenceSourceV1, SupportOmissionReasonV1, SupportTruncationReasonV1,
};
use super::super::schema::limits::{CONTENT_STRING_BYTES, GENERIC_STRING_BYTES, MAX_ID_BYTES};
use super::super::schema::validate::{validate_id, validate_timestamp};
use super::accounting::SupportScrubAccounting;
use super::{
    patterns, SupportExportScrubber, SupportOptionalScrubbed, SupportScrubError, SupportTextKind,
};

const REGEX_SCAN_OVERLAP: usize = 8_192;
const TRUNCATION_MARKER: &str = "...[TRUNCATED]";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum TextRole {
    Generic,
    Content,
    Identifier,
    Name,
    Timestamp,
    ProtocolTimestamp,
    Hash,
}

impl TextRole {
    fn limit(self) -> usize {
        match self {
            Self::Generic => GENERIC_STRING_BYTES,
            Self::Content => CONTENT_STRING_BYTES,
            Self::Identifier
            | Self::Name
            | Self::Timestamp
            | Self::ProtocolTimestamp
            | Self::Hash => MAX_ID_BYTES,
        }
    }

    fn omit_when_oversized(self) -> bool {
        matches!(
            self,
            Self::Identifier | Self::Name | Self::Timestamp | Self::ProtocolTimestamp | Self::Hash
        )
    }

    fn allows_opaque_redaction(self) -> bool {
        matches!(self, Self::Generic | Self::Content)
    }
}

impl From<SupportTextKind> for TextRole {
    fn from(kind: SupportTextKind) -> Self {
        match kind {
            SupportTextKind::Generic => Self::Generic,
            SupportTextKind::Content => Self::Content,
            SupportTextKind::Identifier => Self::Identifier,
            SupportTextKind::Name => Self::Name,
            SupportTextKind::Timestamp => Self::Timestamp,
            SupportTextKind::Hash => Self::Hash,
        }
    }
}

impl SupportExportScrubber {
    /// Scrub one already-valid UTF-8 string under an explicit semantic role.
    pub fn scrub_text(
        &self,
        value: String,
        source: SupportEvidenceSourceV1,
        kind: SupportTextKind,
    ) -> Result<SupportOptionalScrubbed<String>, SupportScrubError> {
        let mut accounting = SupportScrubAccounting::default();
        let value =
            self.scrub_text_into(&value, value.len(), kind.into(), source, &mut accounting)?;
        Ok(SupportOptionalScrubbed { value, accounting })
    }

    /// Decode and scrub only the bounded prefix that can affect output. An
    /// invalid sequence in that prefix omits the optional unit; unscanned tail
    /// bytes are honestly represented by truncation accounting.
    pub fn scrub_utf8(
        &self,
        value: &[u8],
        source: SupportEvidenceSourceV1,
        kind: SupportTextKind,
    ) -> Result<SupportOptionalScrubbed<String>, SupportScrubError> {
        let mut accounting = SupportScrubAccounting::default();
        let role: TextRole = kind.into();
        if role.omit_when_oversized() && value.len() > role.limit() {
            accounting.record_omission(
                source,
                SupportOmissionReasonV1::SourceCap,
                1,
                Some(to_u64(value.len())?),
            )?;
            return Ok(SupportOptionalScrubbed {
                value: None,
                accounting,
            });
        }
        let scan_limit = role.limit().saturating_add(REGEX_SCAN_OVERLAP);
        let decoded = match bounded_utf8_prefix(value, scan_limit) {
            Some(decoded) => decoded,
            None => {
                accounting.record_omission(
                    source,
                    SupportOmissionReasonV1::SourceInvalid,
                    1,
                    Some(to_u64(value.len())?),
                )?;
                return Ok(SupportOptionalScrubbed {
                    value: None,
                    accounting,
                });
            }
        };
        let value = self.scrub_text_into_with_tail(
            decoded,
            value.len(),
            decoded.len() < value.len(),
            role,
            source,
            &mut accounting,
        )?;
        Ok(SupportOptionalScrubbed { value, accounting })
    }

    pub(super) fn scrub_text_into(
        &self,
        input: &str,
        original_bytes: usize,
        role: TextRole,
        source: SupportEvidenceSourceV1,
        accounting: &mut SupportScrubAccounting,
    ) -> Result<Option<String>, SupportScrubError> {
        self.scrub_text_into_with_tail(input, original_bytes, false, role, source, accounting)
    }

    fn scrub_text_into_with_tail(
        &self,
        input: &str,
        original_bytes: usize,
        adapter_has_unscanned_tail: bool,
        role: TextRole,
        source: SupportEvidenceSourceV1,
        accounting: &mut SupportScrubAccounting,
    ) -> Result<Option<String>, SupportScrubError> {
        let limit = role.limit();
        if role.omit_when_oversized() && original_bytes > limit {
            accounting.record_omission(
                source,
                SupportOmissionReasonV1::SourceCap,
                1,
                Some(to_u64(original_bytes)?),
            )?;
            return Ok(None);
        }

        let source_truncated = original_bytes > limit;
        let retained_limit = if source_truncated {
            limit.saturating_sub(TRUNCATION_MARKER.len())
        } else {
            limit
        };
        let retained_source_end = floor_char_boundary(input, input.len().min(retained_limit));
        let scan_limit = limit.saturating_add(REGEX_SCAN_OVERLAP);
        let scan_end = floor_char_boundary(input, input.len().min(scan_limit));
        let bounded = &input[..scan_end];
        let (normalized, visible_end) = self.normalize_home_prefixes(bounded, retained_source_end);
        let output = patterns::apply(
            normalized.into_owned(),
            visible_end,
            role.allows_opaque_redaction(),
            adapter_has_unscanned_tail || scan_end < input.len(),
            accounting,
        )?;

        if output.redacted && role.omit_when_oversized() {
            accounting.record_omission(source, SupportOmissionReasonV1::SourceInvalid, 1, None)?;
            return Ok(None);
        }
        let visible = &output.value[..output.visible_end];
        let semantic_valid = match role {
            TextRole::Identifier | TextRole::Name | TextRole::Hash => validate_id(visible).is_ok(),
            TextRole::Timestamp => validate_timestamp(visible).is_ok(),
            TextRole::ProtocolTimestamp => true,
            TextRole::Generic | TextRole::Content => true,
        };
        if !semantic_valid {
            accounting.record_omission(
                source,
                SupportOmissionReasonV1::SourceInvalid,
                1,
                Some(to_u64(original_bytes)?),
            )?;
            return Ok(None);
        }

        let transformed_truncated = visible.len() > limit;
        let was_truncated = source_truncated || transformed_truncated;
        let value = if was_truncated {
            truncate_utf8_with_marker(visible.to_owned(), limit)
        } else {
            visible.to_owned()
        };
        if was_truncated {
            let omitted_bytes = (source_truncated && !output.redacted)
                .then(|| to_u64(original_bytes.saturating_sub(retained_source_end)))
                .transpose()?;
            accounting.record_truncation(
                source,
                SupportTruncationReasonV1::FieldBytes,
                1,
                omitted_bytes,
            )?;
        }
        Ok(Some(value))
    }

    fn normalize_home_prefixes<'a>(
        &self,
        value: &'a str,
        visible_end: usize,
    ) -> (Cow<'a, str>, usize) {
        let Some(home) = self.home_directory.as_deref() else {
            return (Cow::Borrowed(value), visible_end);
        };
        if !value.contains(home) {
            return (Cow::Borrowed(value), visible_end);
        }

        let mut normalized = String::with_capacity(value.len());
        let mut prior = 0;
        let mut mapped_visible_end = None;
        for (start, _) in value.match_indices(home) {
            if start >= visible_end {
                break;
            }
            let end = start + home.len();
            let exact_prefix = value[end..]
                .chars()
                .next()
                .is_none_or(|next| matches!(next, '/' | '\\'));
            if !exact_prefix {
                continue;
            }
            normalized.push_str(&value[prior..start]);
            normalized.push('~');
            prior = end;
            if end >= visible_end {
                mapped_visible_end = Some(normalized.len());
                break;
            }
        }
        if prior == 0 {
            (Cow::Borrowed(value), visible_end)
        } else {
            let mapped_visible_end = mapped_visible_end.unwrap_or_else(|| {
                normalized.push_str(&value[prior..visible_end]);
                normalized.len()
            });
            let suffix_start = prior.max(visible_end);
            normalized.push_str(&value[suffix_start..]);
            (Cow::Owned(normalized), mapped_visible_end)
        }
    }
}

fn bounded_utf8_prefix(value: &[u8], limit: usize) -> Option<&str> {
    let mut end = value.len().min(limit);
    let maximum = value.len().min(limit.saturating_add(3));
    loop {
        match std::str::from_utf8(&value[..end]) {
            Ok(decoded) => return Some(decoded),
            Err(error)
                if error.error_len().is_none() && error.valid_up_to() < end && end < maximum =>
            {
                end += 1;
            }
            Err(_) => return None,
        }
    }
}

fn truncate_utf8_with_marker(mut value: String, limit: usize) -> String {
    let target = limit.saturating_sub(TRUNCATION_MARKER.len());
    let boundary = floor_char_boundary(&value, value.len().min(target));
    value.truncate(boundary);
    value.push_str(TRUNCATION_MARKER);
    value
}

fn floor_char_boundary(value: &str, mut boundary: usize) -> usize {
    while boundary > 0 && !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    boundary
}

pub(super) fn to_u64(value: usize) -> Result<u64, SupportScrubError> {
    u64::try_from(value).map_err(|_| SupportScrubError::AccountingOverflow)
}
