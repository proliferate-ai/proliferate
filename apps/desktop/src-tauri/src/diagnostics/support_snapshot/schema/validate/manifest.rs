//! Manifest bounds, accounting, and deterministic aggregate validation.

use super::super::enums::{SupportSourceManifestSourceV1, SupportSourceStateV1};
use super::super::limits::{
    ALL_FILES_READ_BYTES, ANYHARNESS_FALLBACK_BYTES, COLLECTOR_BYTES, COMPONENT_FILES_READ_BYTES,
    DEGRADATION_POLICY_VERSION, DESKTOP_NATIVE_FALLBACK_BYTES, DESKTOP_WORKER_FALLBACK_BYTES,
    EVENT_RESPONSE_BYTES, MANIFEST_BYTES, MANIFEST_SCHEMA_VERSION, MAX_GAP_ENTRIES,
    MAX_OMISSION_ENTRIES, MAX_SOURCE_ENTRIES, MAX_TRUNCATION_ENTRIES,
    RAW_NOTIFICATION_RESPONSE_BYTES, SESSIONS, SESSION_EVIDENCE_BYTES, SESSION_LIST_RESPONSE_BYTES,
};
use super::super::model::common::{SupportOmissionV1, SupportTruncationV1};
use super::super::model::manifest::{
    SupportSecretScrubCountsV1, SupportSessionCollectionManifestV1, SupportSnapshotLimitsV1,
    SupportSnapshotManifestV1, SupportSourceManifestV1,
};
use super::{evidence, protocol};
use super::{
    validate_id, validate_optional_safe_u64, validate_safe_u64, validate_timestamp,
    SupportSchemaError,
};

fn validate_limits(limits: &SupportSnapshotLimitsV1) -> Result<(), SupportSchemaError> {
    if *limits != SupportSnapshotLimitsV1::fixed() {
        return Err(SupportSchemaError::PinnedLiteralMismatch("manifest.limits"));
    }
    Ok(())
}

fn validate_source(source: &SupportSourceManifestV1) -> Result<(), SupportSchemaError> {
    validate_timestamp(&source.captured_at)?;
    validate_safe_u64(source.read_bytes)?;
    validate_safe_u64(source.included_bytes)?;
    validate_safe_u64(source.included_items)?;
    if source.state != SupportSourceStateV1::Included
        && (source.included_bytes != 0 || source.included_items != 0)
    {
        return Err(SupportSchemaError::InvariantViolation(
            "non-included source carries included evidence",
        ));
    }
    if source.included_bytes > source.read_bytes {
        return Err(SupportSchemaError::InvariantViolation(
            "source included bytes exceed read bytes",
        ));
    }
    let (read_cap, included_cap) = match source.source {
        SupportSourceManifestSourceV1::Collector => (COLLECTOR_BYTES, COLLECTOR_BYTES),
        SupportSourceManifestSourceV1::DesktopNativeFallback => {
            (DESKTOP_NATIVE_FALLBACK_BYTES, DESKTOP_NATIVE_FALLBACK_BYTES)
        }
        SupportSourceManifestSourceV1::AnyharnessFallback => {
            (ANYHARNESS_FALLBACK_BYTES, ANYHARNESS_FALLBACK_BYTES)
        }
        SupportSourceManifestSourceV1::DesktopWorkerFallback => {
            (DESKTOP_WORKER_FALLBACK_BYTES, DESKTOP_WORKER_FALLBACK_BYTES)
        }
        SupportSourceManifestSourceV1::RendererLegacy
        | SupportSourceManifestSourceV1::AnyharnessLegacy
        | SupportSourceManifestSourceV1::WorkerLegacyV2
        | SupportSourceManifestSourceV1::WorkerLegacyV1 => {
            (COMPONENT_FILES_READ_BYTES, COMPONENT_FILES_READ_BYTES)
        }
        SupportSourceManifestSourceV1::SessionLedger => {
            (SESSION_EVIDENCE_BYTES, SESSION_EVIDENCE_BYTES)
        }
    };
    if source.read_bytes > read_cap || source.included_bytes > included_cap {
        return Err(SupportSchemaError::CapExceeded("manifest source bytes"));
    }
    Ok(())
}

fn validate_sources(sources: &[SupportSourceManifestV1]) -> Result<(), SupportSchemaError> {
    if sources.len() > MAX_SOURCE_ENTRIES {
        return Err(SupportSchemaError::CapExceeded("manifest.sources"));
    }
    let mut prior = None;
    let mut file_bytes = 0_u64;
    let mut desktop_family_bytes = 0_u64;
    let mut anyharness_family_bytes = 0_u64;
    let mut worker_family_bytes = 0_u64;
    for source in sources {
        validate_source(source)?;
        if prior.is_some_and(|prior| source.source <= prior) {
            return Err(SupportSchemaError::InvariantViolation(
                "manifest source order/uniqueness",
            ));
        }
        prior = Some(source.source);
        if !matches!(
            source.source,
            SupportSourceManifestSourceV1::Collector | SupportSourceManifestSourceV1::SessionLedger
        ) {
            file_bytes = file_bytes
                .checked_add(source.read_bytes)
                .ok_or(SupportSchemaError::UnsafeInteger)?;
        }
        let family_bytes = match source.source {
            SupportSourceManifestSourceV1::DesktopNativeFallback
            | SupportSourceManifestSourceV1::RendererLegacy => Some(&mut desktop_family_bytes),
            SupportSourceManifestSourceV1::AnyharnessFallback
            | SupportSourceManifestSourceV1::AnyharnessLegacy => Some(&mut anyharness_family_bytes),
            SupportSourceManifestSourceV1::DesktopWorkerFallback
            | SupportSourceManifestSourceV1::WorkerLegacyV2
            | SupportSourceManifestSourceV1::WorkerLegacyV1 => Some(&mut worker_family_bytes),
            SupportSourceManifestSourceV1::Collector
            | SupportSourceManifestSourceV1::SessionLedger => None,
        };
        if let Some(family_bytes) = family_bytes {
            *family_bytes = (*family_bytes)
                .checked_add(source.read_bytes)
                .ok_or(SupportSchemaError::UnsafeInteger)?;
        }
    }
    if file_bytes > ALL_FILES_READ_BYTES {
        return Err(SupportSchemaError::CapExceeded(
            "manifest all file read bytes",
        ));
    }
    if [
        desktop_family_bytes,
        anyharness_family_bytes,
        worker_family_bytes,
    ]
    .into_iter()
    .any(|bytes| bytes > COMPONENT_FILES_READ_BYTES)
    {
        return Err(SupportSchemaError::CapExceeded(
            "manifest logical-family read bytes",
        ));
    }
    Ok(())
}

fn validate_session_collection(
    collection: &SupportSessionCollectionManifestV1,
) -> Result<(), SupportSchemaError> {
    match collection {
        SupportSessionCollectionManifestV1::Included {
            workspace_id,
            anyharness_workspace_id,
            selected_sessions,
            session_included_bytes,
            event_included_bytes,
            raw_notification_included_bytes,
            limit_uncertain_endpoints,
        } => {
            validate_id(workspace_id)?;
            validate_id(anyharness_workspace_id)?;
            for count in [
                *selected_sessions,
                *session_included_bytes,
                *event_included_bytes,
                *raw_notification_included_bytes,
                *limit_uncertain_endpoints,
            ] {
                validate_safe_u64(count)?;
            }
            if *selected_sessions > SESSIONS {
                return Err(SupportSchemaError::CapExceeded(
                    "sessionCollection.selectedSessions",
                ));
            }
            if *selected_sessions == 0
                && (*session_included_bytes != 0
                    || *event_included_bytes != 0
                    || *raw_notification_included_bytes != 0)
            {
                return Err(SupportSchemaError::InvariantViolation(
                    "empty sessionCollection accounting",
                ));
            }
            if *session_included_bytes > SESSION_LIST_RESPONSE_BYTES {
                return Err(SupportSchemaError::CapExceeded(
                    "sessionCollection.sessionIncludedBytes",
                ));
            }
            if *event_included_bytes > EVENT_RESPONSE_BYTES.saturating_mul(*selected_sessions)
                || *raw_notification_included_bytes
                    > RAW_NOTIFICATION_RESPONSE_BYTES.saturating_mul(*selected_sessions)
            {
                return Err(SupportSchemaError::CapExceeded(
                    "sessionCollection endpoint bytes",
                ));
            }
            let total = session_included_bytes
                .checked_add(*event_included_bytes)
                .and_then(|value| value.checked_add(*raw_notification_included_bytes))
                .ok_or(SupportSchemaError::UnsafeInteger)?;
            if total > SESSION_EVIDENCE_BYTES {
                return Err(SupportSchemaError::CapExceeded(
                    "sessionCollection evidence bytes",
                ));
            }
            // One active-get/recent-list response plus two per-session list
            // endpoints. A zero-item recent list can itself be uncertain.
            if *limit_uncertain_endpoints > (*selected_sessions).saturating_mul(2).saturating_add(1)
            {
                return Err(SupportSchemaError::InvariantViolation(
                    "sessionCollection limit-uncertain endpoints",
                ));
            }
        }
        SupportSessionCollectionManifestV1::Omitted { .. } => {}
    }
    Ok(())
}

fn validate_omissions(omissions: &[SupportOmissionV1]) -> Result<(), SupportSchemaError> {
    if omissions.len() > MAX_OMISSION_ENTRIES {
        return Err(SupportSchemaError::CapExceeded("manifest.omissions"));
    }
    let mut prior = None;
    for omission in omissions {
        validate_safe_u64(omission.count)?;
        validate_optional_safe_u64(omission.known_bytes)?;
        let key = (omission.source, omission.reason);
        if prior.is_some_and(|prior| key <= prior) {
            return Err(SupportSchemaError::InvariantViolation(
                "manifest omission order/aggregation",
            ));
        }
        prior = Some(key);
    }
    Ok(())
}

fn validate_truncations(truncations: &[SupportTruncationV1]) -> Result<(), SupportSchemaError> {
    if truncations.len() > MAX_TRUNCATION_ENTRIES {
        return Err(SupportSchemaError::CapExceeded("manifest.truncations"));
    }
    let mut prior = None;
    for truncation in truncations {
        validate_safe_u64(truncation.count)?;
        validate_optional_safe_u64(truncation.omitted_bytes)?;
        let key = (truncation.source, truncation.reason);
        if prior.is_some_and(|prior| key <= prior) {
            return Err(SupportSchemaError::InvariantViolation(
                "manifest truncation order/aggregation",
            ));
        }
        prior = Some(key);
    }
    Ok(())
}

fn validate_scrub_counts(counts: &SupportSecretScrubCountsV1) -> Result<(), SupportSchemaError> {
    for count in [
        counts.authorization,
        counts.cookie,
        counts.access_token,
        counts.refresh_token,
        counts.identity_token,
        counts.api_key,
        counts.client_secret,
        counts.password,
        counts.private_key,
        counts.credential_container,
        counts.environment_secret,
        counts.signed_url,
        counts.provider_credential,
        counts.opaque_credential,
        counts.url_userinfo,
    ] {
        validate_safe_u64(count)?;
    }
    Ok(())
}

pub(super) fn validate_manifest(
    manifest: &SupportSnapshotManifestV1,
) -> Result<(), SupportSchemaError> {
    if manifest.schema_version != MANIFEST_SCHEMA_VERSION {
        return Err(SupportSchemaError::PinnedLiteralMismatch(
            "manifest.schemaVersion",
        ));
    }
    validate_timestamp(&manifest.generated_at)?;
    validate_safe_u64(manifest.serialized_bytes)?;
    validate_limits(&manifest.limits)?;
    evidence::validate_collector_coverage(&manifest.collector)?;
    validate_sources(&manifest.sources)?;
    validate_session_collection(&manifest.session_collection)?;
    if manifest.gaps.len() > MAX_GAP_ENTRIES {
        return Err(SupportSchemaError::CapExceeded("manifest.gaps"));
    }
    for gap in &manifest.gaps {
        protocol::gap(gap, "manifest.gaps")?;
    }
    validate_omissions(&manifest.omissions)?;
    validate_truncations(&manifest.truncations)?;
    validate_scrub_counts(&manifest.scrubbed_by_class)?;
    if manifest.degradation.policy_version != DEGRADATION_POLICY_VERSION {
        return Err(SupportSchemaError::PinnedLiteralMismatch(
            "degradation.policyVersion",
        ));
    }
    for removed in manifest.degradation.removed_by_tier {
        validate_safe_u64(removed)?;
    }
    for additional in [
        manifest.additional_entries.gaps,
        manifest.additional_entries.omissions,
        manifest.additional_entries.truncations,
    ] {
        validate_safe_u64(additional)?;
    }
    let bytes = serde_json::to_vec(manifest)
        .map_err(|_| SupportSchemaError::SerializationFailed)?
        .len() as u64;
    if bytes > MANIFEST_BYTES {
        return Err(SupportSchemaError::CapExceeded("manifest serialized bytes"));
    }
    Ok(())
}
