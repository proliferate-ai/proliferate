//! Native supervisor and child-producer health validation.

use proliferate_diagnostics_protocol::v1::types::HealthStatusV1;

use super::super::enums::SupportChildComponentV1;
use super::super::limits::{COLLECTOR_SCHEMA_MAJOR, MAX_SAFE_INTEGER};
use super::super::model::health::{
    DesktopDiagnosticsHealthV1, DesktopDiagnosticsSupervisorStateV1, SupportChildCollectorStateV1,
    SupportChildProducerSnapshotV1, SupportChildProducerStatusV1, SupportLossCountsV1,
    SupportProducerHealthV1, SupportTauriProducerHealthV1,
};
use super::protocol;
use super::{
    validate_id, validate_optional_safe_u64, validate_safe_u64, validate_timestamp,
    SupportSchemaError,
};

pub(super) fn validate_desktop_health(
    health: &DesktopDiagnosticsHealthV1,
) -> Result<(), SupportSchemaError> {
    protocol::fallback_health(&health.fallback)?;
    match &health.supervisor {
        DesktopDiagnosticsSupervisorStateV1::Ready {
            collector_boot_id,
            schema_major,
            restart_count,
        } => {
            validate_id(collector_boot_id)?;
            if *schema_major != COLLECTOR_SCHEMA_MAJOR {
                return Err(SupportSchemaError::PinnedLiteralMismatch(
                    "supervisor.schemaMajor",
                ));
            }
            validate_safe_u64(*restart_count)?;
            if let Some(collector) = &health.collector {
                protocol::health(collector, "desktopHealth.collector")?;
                if collector.status != HealthStatusV1::Ready
                    || collector.collector_boot_id != *collector_boot_id
                    || collector.restart_count != *restart_count
                    || collector.fallback != health.fallback
                {
                    return Err(SupportSchemaError::InvariantViolation(
                        "desktopHealth ready collector identity",
                    ));
                }
            }
        }
        DesktopDiagnosticsSupervisorStateV1::Starting {
            attempt,
            restart_count,
            ..
        } => {
            validate_safe_u64(*attempt)?;
            validate_safe_u64(*restart_count)?;
            reject_collector_outside_ready(health)?;
        }
        DesktopDiagnosticsSupervisorStateV1::Degraded { restart_count, .. } => {
            validate_safe_u64(*restart_count)?;
            reject_collector_outside_ready(health)?;
        }
        DesktopDiagnosticsSupervisorStateV1::Unsupported { .. }
        | DesktopDiagnosticsSupervisorStateV1::Stopped { .. } => {
            reject_collector_outside_ready(health)?;
        }
    }
    Ok(())
}

fn reject_collector_outside_ready(
    health: &DesktopDiagnosticsHealthV1,
) -> Result<(), SupportSchemaError> {
    if health.collector.is_some() {
        return Err(SupportSchemaError::InvariantViolation(
            "desktopHealth collector requires ready supervisor",
        ));
    }
    Ok(())
}

fn validate_loss_counts(counts: &SupportLossCountsV1) -> Result<(), SupportSchemaError> {
    for count in [
        counts.queue_records,
        counts.queue_bytes,
        counts.protected_eviction,
        counts.pressure,
        counts.generation_changed,
        counts.transport_timeout,
        counts.transport_failure,
        counts.receipt_invalid,
        counts.receipt_rejected,
        counts.fallback_overflow,
        counts.fallback_write_failed,
        counts.shutdown_timeout,
        counts.filter_invalid,
        counts.sequence_exhausted,
    ] {
        validate_safe_u64(count)?;
    }
    Ok(())
}

fn validate_sequence_pair(
    snapshot: &SupportChildProducerSnapshotV1,
) -> Result<(), SupportSchemaError> {
    match (snapshot.last_assigned_sequence, snapshot.next_sequence) {
        (None, Some(1)) => Ok(()),
        (Some(last), Some(next)) if last < MAX_SAFE_INTEGER && next == last + 1 => Ok(()),
        (Some(MAX_SAFE_INTEGER), None) => Ok(()),
        _ => Err(SupportSchemaError::InvariantViolation(
            "child producer sequence pair",
        )),
    }
}

fn validate_child_snapshot(
    snapshot: &SupportChildProducerSnapshotV1,
    expected_component: SupportChildComponentV1,
) -> Result<(), SupportSchemaError> {
    if snapshot.component != expected_component {
        return Err(SupportSchemaError::InvariantViolation(
            "child producer component identity",
        ));
    }
    validate_id(&snapshot.producer_boot_id)?;
    validate_optional_safe_u64(snapshot.last_assigned_sequence)?;
    validate_optional_safe_u64(snapshot.next_sequence)?;
    validate_sequence_pair(snapshot)?;
    if let SupportChildCollectorStateV1::Ready {
        collector_boot_id,
        generation_number,
    } = &snapshot.collector_state
    {
        validate_id(collector_boot_id)?;
        validate_safe_u64(*generation_number)?;
    }
    for count in [
        snapshot.resident_records,
        snapshot.resident_bytes,
        snapshot.fallback_bytes,
        snapshot.fallback_write_failures,
        snapshot.fallback_routed,
    ] {
        validate_safe_u64(count)?;
    }
    validate_loss_counts(&snapshot.dropped_by_reason)?;
    if snapshot.fallback_write_failures != snapshot.dropped_by_reason.fallback_write_failed {
        return Err(SupportSchemaError::InvariantViolation(
            "child fallback-write failure accounting",
        ));
    }
    if snapshot
        .last_failure
        .is_some_and(|reason| snapshot.dropped_by_reason.get(reason) == 0)
    {
        return Err(SupportSchemaError::InvariantViolation(
            "child last-failure accounting",
        ));
    }
    Ok(())
}

fn validate_child_status(
    status: &SupportChildProducerStatusV1,
    expected_component: SupportChildComponentV1,
) -> Result<(), SupportSchemaError> {
    match status {
        SupportChildProducerStatusV1::Available {
            captured_at,
            snapshot,
        } => {
            validate_timestamp(captured_at)?;
            validate_child_snapshot(snapshot, expected_component)
        }
        SupportChildProducerStatusV1::Omitted { captured_at, .. } => {
            validate_timestamp(captured_at)
        }
    }
}

pub(super) fn validate_producer_health(
    health: &SupportProducerHealthV1,
) -> Result<(), SupportSchemaError> {
    if let SupportTauriProducerHealthV1::SupervisorOnly { desktop_health, .. } = &health.tauri {
        validate_desktop_health(desktop_health)?;
    }
    validate_child_status(&health.anyharness, SupportChildComponentV1::Anyharness)?;
    validate_child_status(
        &health.desktop_worker,
        SupportChildComponentV1::DesktopWorker,
    )
}
