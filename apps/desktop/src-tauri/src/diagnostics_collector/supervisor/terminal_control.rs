use std::future::Future;
use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use proliferate_diagnostics_protocol::v1::limits::MAX_ID_BYTES;
use serde::Serialize;
use tokio::sync::Mutex as AsyncMutex;

use super::{DesktopDiagnosticsSupervisorStateV1, DiagnosticsCollectorSupervisor};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TerminalProducerSlot {
    AnyHarness,
    DesktopWorker,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TerminalControlOutcome {
    Recorded,
    Stale,
    Unavailable,
    Ambiguous,
}

pub(super) struct TerminalControlState {
    slots: Mutex<TerminalSlots>,
    writer: AsyncMutex<()>,
    writer_ambiguous: AtomicBool,
}

#[derive(Default)]
struct TerminalSlots {
    anyharness: Option<TerminalBinding>,
    desktop_worker: Option<TerminalBinding>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct TerminalBinding {
    collector_boot_id: String,
    generation: u64,
    producer_boot_id: String,
}

struct TerminalReservation {
    binding: TerminalBinding,
}

#[derive(Clone, Copy)]
struct TerminalCollectorView<'a> {
    collector_boot_id: &'a str,
    generation: u64,
    available: bool,
    shutdown_armed: bool,
}

#[derive(Serialize)]
#[serde(tag = "command", rename_all = "snake_case")]
enum TerminalCommand<'a> {
    ProducerDead { producer_boot_id: &'a str },
}

impl Default for TerminalControlState {
    fn default() -> Self {
        Self {
            slots: Mutex::new(TerminalSlots::default()),
            writer: AsyncMutex::new(()),
            writer_ambiguous: AtomicBool::new(false),
        }
    }
}

impl TerminalControlState {
    fn reserve_if_current(
        &self,
        slot: TerminalProducerSlot,
        expected_collector_boot_id: &str,
        expected_generation: u64,
        producer_boot_id: &str,
        current: Option<TerminalCollectorView<'_>>,
    ) -> Result<TerminalReservation, TerminalControlOutcome> {
        if !valid_id(expected_collector_boot_id) || !valid_id(producer_boot_id) {
            return Err(TerminalControlOutcome::Unavailable);
        }
        let current = current.ok_or(TerminalControlOutcome::Unavailable)?;
        if !current.available {
            return Err(TerminalControlOutcome::Unavailable);
        }
        // Terminal control intentionally remains available after shutdown is
        // armed. The collector has not yet been taken or stopped at this phase.
        let _post_arm_terminal_authority = current.shutdown_armed;
        if current.collector_boot_id != expected_collector_boot_id
            || current.generation != expected_generation
        {
            return Err(TerminalControlOutcome::Stale);
        }
        if self.writer_ambiguous.load(Ordering::Acquire) {
            return Err(TerminalControlOutcome::Ambiguous);
        }

        let binding = TerminalBinding {
            collector_boot_id: expected_collector_boot_id.to_owned(),
            generation: expected_generation,
            producer_boot_id: producer_boot_id.to_owned(),
        };
        let mut slots = self
            .slots
            .lock()
            .map_err(|_| TerminalControlOutcome::Unavailable)?;
        let occupied = match slot {
            TerminalProducerSlot::AnyHarness => &mut slots.anyharness,
            TerminalProducerSlot::DesktopWorker => &mut slots.desktop_worker,
        };
        if let Some(existing) = occupied.as_ref() {
            if existing == &binding || existing.producer_boot_id == producer_boot_id {
                return Err(TerminalControlOutcome::Ambiguous);
            }
        }
        // Consuming the slot before any I/O await makes cancellation, partial
        // writes, and unknown delivery permanently non-retryable for this boot.
        *occupied = Some(binding.clone());
        Ok(TerminalReservation { binding })
    }

    async fn dispatch<W, F>(
        &self,
        reservation: TerminalReservation,
        write: W,
    ) -> TerminalControlOutcome
    where
        W: FnOnce(Vec<u8>) -> F,
        F: Future<Output = Result<(), io::Error>>,
    {
        let command = match typed_producer_dead_command(&reservation.binding.producer_boot_id) {
            Ok(command) => command,
            Err(_) => return TerminalControlOutcome::Unavailable,
        };
        let _writer = self.writer.lock().await;
        if self.writer_ambiguous.load(Ordering::Acquire) {
            return TerminalControlOutcome::Ambiguous;
        }
        match write(command).await {
            Ok(()) => TerminalControlOutcome::Recorded,
            Err(_) => {
                self.writer_ambiguous.store(true, Ordering::Release);
                TerminalControlOutcome::Ambiguous
            }
        }
    }

    /// Called only while the supervisor lifecycle decision mutex owns a newly
    /// accepted collector process and before that generation is published.
    pub(super) fn reset_for_new_collector(&self) {
        if let Ok(mut slots) = self.slots.lock() {
            *slots = TerminalSlots::default();
            self.writer_ambiguous.store(false, Ordering::Release);
        }
    }

    /// A partial/unknown terminal write corrupts newline framing; shutdown
    /// must force-reap instead of appending another command to that stream.
    pub(super) fn writer_is_ambiguous(&self) -> bool {
        self.writer_ambiguous.load(Ordering::Acquire)
    }
}

impl DiagnosticsCollectorSupervisor {
    pub(crate) async fn send_producer_dead_if_current(
        &self,
        slot: TerminalProducerSlot,
        expected_collector_boot_id: &str,
        expected_generation: u64,
        producer_boot_id: &str,
    ) -> TerminalControlOutcome {
        // The existing lifecycle mutex serializes this terminal write with
        // collector replacement and shutdown. It is async and may safely be
        // retained while the control write awaits.
        let _decision = self.decisions.lock().await;
        let (reservation, descriptor) = {
            let inner = match self.inner.lock() {
                Ok(inner) => inner,
                Err(_) => return TerminalControlOutcome::Unavailable,
            };
            let process = match inner.process.as_ref() {
                Some(process) => process,
                None => return TerminalControlOutcome::Unavailable,
            };
            let state_boot_id = match &inner.state {
                DesktopDiagnosticsSupervisorStateV1::Ready {
                    collector_boot_id, ..
                } => collector_boot_id,
                _ => return TerminalControlOutcome::Unavailable,
            };
            if state_boot_id != &process.descriptor().collector_boot_id {
                return TerminalControlOutcome::Unavailable;
            }
            let current = TerminalCollectorView {
                collector_boot_id: state_boot_id,
                generation: inner.generation,
                available: true,
                shutdown_armed: self.shutdown_armed.load(Ordering::Acquire),
            };
            let reservation = match self.terminal_control.reserve_if_current(
                slot,
                expected_collector_boot_id,
                expected_generation,
                producer_boot_id,
                Some(current),
            ) {
                Ok(reservation) => reservation,
                Err(outcome) => return outcome,
            };
            let descriptor = match process.duplicate_terminal_control_descriptor() {
                Ok(descriptor) => descriptor,
                Err(_) => return TerminalControlOutcome::Unavailable,
            };
            (reservation, descriptor)
        };

        self.terminal_control
            .dispatch(reservation, move |command| async move {
                super::OwnedCollectorProcess::write_terminal_control_line(descriptor, &command)
                    .await
            })
            .await
    }
}

fn typed_producer_dead_command(producer_boot_id: &str) -> Result<Vec<u8>, io::Error> {
    if !valid_id(producer_boot_id) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "producer boot identity is invalid",
        ));
    }
    serde_json::to_vec(&TerminalCommand::ProducerDead { producer_boot_id })
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "producer-dead command"))
}

fn valid_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= MAX_ID_BYTES
}

#[cfg(test)]
#[path = "terminal_control_tests.rs"]
mod tests;
