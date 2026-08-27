use chrono::{DateTime, Utc};

use super::super::assembly::SupportAssemblyCandidateV1;
use super::super::schema::enums::{SupportEvidenceSourceV1, SupportOmissionReasonV1};
use super::super::schema::limits::MAX_SAFE_INTEGER;
use super::super::schema::model::common::{SupportJsonValueV1, SupportOmissionV1};
use super::super::schema::validate::validate_timestamp;
use super::super::scrub::{SupportExportScrubber, SupportOptionalScrubbed};
use super::byte_allocation::allocate_exact_response_bytes;
use super::session_accounting::SessionInputError;
use super::session_input::IndexedEvidenceV1;

pub(super) struct ScrubbedIndexedValue {
    original_index: u64,
    scrubbed: SupportOptionalScrubbed<SupportJsonValueV1>,
}

pub(super) fn scrub_items(
    items: Vec<IndexedEvidenceV1>,
    session_id: &str,
    source_time_from: &str,
    source_time_to: &str,
    scrubber: &SupportExportScrubber,
) -> Result<Vec<ScrubbedIndexedValue>, SessionInputError> {
    let from = parse_time(source_time_from)?;
    let to = parse_time(source_time_to)?;
    let mut prior_sequence = None;
    let mut output = Vec::with_capacity(items.len());
    for (index, item) in items.into_iter().enumerate() {
        if item.index != index as u64 {
            return Err(SessionInputError::Incoherent);
        }
        let Some(sequence) = valid_inner(&item.value, session_id, &from, &to, prior_sequence)
        else {
            continue;
        };
        prior_sequence = Some(sequence);
        let value = own_untrusted_json(item.value)?;
        let mut scrubbed = scrubber
            .scrub_optional_value(value, SupportEvidenceSourceV1::SessionLedger)
            .map_err(|_| SessionInputError::Scrub)?;
        if scrubbed
            .value
            .as_ref()
            .is_some_and(|value| !owned_inner_is_bound(value, session_id, &from, &to, sequence))
        {
            scrubbed.value = None;
            scrubbed.accounting.omissions.push(SupportOmissionV1 {
                source: SupportEvidenceSourceV1::SessionLedger,
                reason: SupportOmissionReasonV1::SessionInvalid,
                count: 1,
                known_bytes: None,
            });
        }
        output.push(ScrubbedIndexedValue {
            original_index: item.index,
            scrubbed,
        });
    }
    Ok(output)
}

pub(super) fn scrubbed_summary_is_bound(
    value: &SupportJsonValueV1,
    session_id: &str,
    anyharness_workspace_id: &str,
    updated_at: &DateTime<Utc>,
) -> bool {
    let SupportJsonValueV1::Object(entries) = value else {
        return false;
    };
    let string = |key: &str| {
        entries.iter().find_map(|(candidate, value)| {
            (candidate == key)
                .then_some(value)
                .and_then(|value| match value {
                    SupportJsonValueV1::String(value) => Some(value.as_str()),
                    _ => None,
                })
        })
    };
    string("id") == Some(session_id)
        && string("workspaceId") == Some(anyharness_workspace_id)
        && string("updatedAt")
            .and_then(|value| parse_time(value).ok())
            .as_ref()
            == Some(updated_at)
}

fn owned_inner_is_bound(
    value: &SupportJsonValueV1,
    session_id: &str,
    from: &DateTime<Utc>,
    to: &DateTime<Utc>,
    sequence: u64,
) -> bool {
    let SupportJsonValueV1::Object(entries) = value else {
        return false;
    };
    let field = |key: &str| {
        entries
            .iter()
            .find_map(|(candidate, value)| (candidate == key).then_some(value))
    };
    let valid_sequence = match field("seq") {
        Some(SupportJsonValueV1::Integer(value)) => u64::try_from(*value).ok() == Some(sequence),
        _ => false,
    };
    let valid_session = matches!(
        field("sessionId"),
        Some(SupportJsonValueV1::String(value)) if value == session_id
    );
    let valid_time = match field("timestamp") {
        Some(SupportJsonValueV1::String(value)) => {
            parse_time(value).is_ok_and(|value| &value >= from && &value <= to)
        }
        _ => false,
    };
    valid_sequence && valid_session && valid_time
}

pub(super) fn own_untrusted_json(
    value: serde_json::Value,
) -> Result<SupportJsonValueV1, SessionInputError> {
    Ok(match value {
        serde_json::Value::Null => SupportJsonValueV1::Null,
        serde_json::Value::Bool(value) => SupportJsonValueV1::Bool(value),
        serde_json::Value::Number(value) => {
            if let Some(integer) = value.as_i64() {
                SupportJsonValueV1::Integer(integer)
            } else if let Some(integer) = value.as_u64() {
                if let Ok(integer) = i64::try_from(integer) {
                    SupportJsonValueV1::Integer(integer)
                } else {
                    SupportJsonValueV1::Number(integer as f64)
                }
            } else {
                SupportJsonValueV1::Number(value.as_f64().ok_or(SessionInputError::Invalid)?)
            }
        }
        serde_json::Value::String(value) => SupportJsonValueV1::String(value),
        serde_json::Value::Array(values) => SupportJsonValueV1::Array(
            values
                .into_iter()
                .map(own_untrusted_json)
                .collect::<Result<_, _>>()?,
        ),
        serde_json::Value::Object(values) => SupportJsonValueV1::Object(
            values
                .into_iter()
                .map(|(key, value)| own_untrusted_json(value).map(|value| (key, value)))
                .collect::<Result<_, _>>()?,
        ),
    })
}

pub(super) fn attach_bytes(
    values: Vec<ScrubbedIndexedValue>,
    total_bytes: u64,
) -> Result<Vec<SupportAssemblyCandidateV1<SupportJsonValueV1>>, SessionInputError> {
    let mut candidates = values
        .into_iter()
        .map(|value| SupportAssemblyCandidateV1 {
            scrubbed: value.scrubbed,
            included_bytes: 0,
            original_index: value.original_index,
        })
        .collect::<Vec<_>>();
    allocate_exact_response_bytes(&mut candidates, total_bytes)
        .map_err(|_| SessionInputError::Incoherent)?;
    Ok(candidates)
}

fn valid_inner(
    value: &serde_json::Value,
    session_id: &str,
    from: &DateTime<Utc>,
    to: &DateTime<Utc>,
    prior_sequence: Option<u64>,
) -> Option<u64> {
    let object = value.as_object()?;
    let sequence = object.get("seq")?.as_u64()?;
    if sequence > MAX_SAFE_INTEGER || prior_sequence.is_some_and(|prior| sequence <= prior) {
        return None;
    }
    if object.get("sessionId")?.as_str()? != session_id {
        return None;
    }
    let timestamp = object.get("timestamp")?.as_str()?;
    validate_timestamp(timestamp).ok()?;
    let timestamp = DateTime::parse_from_rfc3339(timestamp)
        .ok()?
        .with_timezone(&Utc);
    (&timestamp >= from && &timestamp <= to).then_some(sequence)
}

fn parse_time(value: &str) -> Result<DateTime<Utc>, SessionInputError> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|_| SessionInputError::Invalid)
}

pub(super) fn summary_binding_time(
    value: &serde_json::Value,
    session_id: &str,
    anyharness_workspace_id: &str,
    source_time_from: Option<&str>,
    source_time_to: &str,
) -> Option<DateTime<Utc>> {
    let object = value.as_object()?;
    if object.contains_key("liveConfig") {
        return None;
    }
    if object.get("id").and_then(serde_json::Value::as_str) != Some(session_id) {
        return None;
    }
    if object
        .get("workspaceId")
        .and_then(serde_json::Value::as_str)
        != Some(anyharness_workspace_id)
    {
        return None;
    }
    let updated_at = object
        .get("updatedAt")
        .and_then(serde_json::Value::as_str)?;
    validate_timestamp(updated_at).ok()?;
    let updated = parse_time(updated_at).ok()?;
    let cutoff = parse_time(source_time_to).ok()?;
    if updated > cutoff {
        return None;
    }
    if let Some(source_time_from) = source_time_from {
        if updated < parse_time(source_time_from).ok()? {
            return None;
        }
    }
    Some(updated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inner_sequence_timestamp_and_session_binding_are_closed() {
        let from = parse_time("2026-08-12T00:00:00Z").expect("from");
        let to = parse_time("2026-08-12T00:00:05Z").expect("to");
        let valid = serde_json::json!({
            "seq": 1,
            "timestamp": "2026-08-12T00:00:05Z",
            "sessionId": "session"
        });
        assert_eq!(valid_inner(&valid, "session", &from, &to, None), Some(1));
        assert_eq!(valid_inner(&valid, "session", &from, &to, Some(1)), None);

        let future = serde_json::json!({
            "seq": 2,
            "timestamp": "2026-08-12T00:00:05.001Z",
            "sessionId": "session"
        });
        assert_eq!(valid_inner(&future, "session", &from, &to, None), None);
        let wrong_session = serde_json::json!({
            "seq": 2,
            "timestamp": "2026-08-12T00:00:01Z",
            "sessionId": "other"
        });
        assert_eq!(
            valid_inner(&wrong_session, "session", &from, &to, None),
            None
        );
    }

    #[test]
    fn summary_id_and_updated_at_must_match_the_native_cutoff() {
        assert!(summary_binding_time(
            &serde_json::json!({
                "id": "session",
                "workspaceId": "runtime-workspace",
                "updatedAt": "2026-08-12T00:00:05Z"
            }),
            "session",
            "runtime-workspace",
            Some("2026-08-12T00:00:00Z"),
            "2026-08-12T00:00:05Z",
        )
        .is_some());
        assert!(summary_binding_time(
            &serde_json::json!({
                "id": "session",
                "workspaceId": "runtime-workspace",
                "updatedAt": "2026-08-12T00:00:05.001Z"
            }),
            "session",
            "runtime-workspace",
            Some("2026-08-12T00:00:00Z"),
            "2026-08-12T00:00:05Z",
        )
        .is_none());
        assert!(summary_binding_time(
            &serde_json::json!({
                "id": "session",
                "workspaceId": "other-workspace",
                "updatedAt": "2026-08-12T00:00:01Z"
            }),
            "session",
            "runtime-workspace",
            Some("2026-08-12T00:00:00Z"),
            "2026-08-12T00:00:05Z",
        )
        .is_none());
    }

    #[test]
    fn hostile_oversized_optional_content_reaches_the_bounded_scrubber() {
        let value = own_untrusted_json(serde_json::json!({
            "message": "x".repeat(20_000)
        }))
        .expect("owned value");
        let scrubbed = SupportExportScrubber::default()
            .scrub_optional_value(value, SupportEvidenceSourceV1::SessionLedger)
            .expect("bounded optional scrub");
        assert!(scrubbed.value.is_some());
        assert!(scrubbed.accounting.truncations.iter().any(|entry| {
            entry.reason
                == super::super::super::schema::enums::SupportTruncationReasonV1::FieldBytes
        }));
    }
}
