use std::future::Future;
use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use proliferate_diagnostics_protocol::v1::limits::MAX_ID_BYTES;
use serde::Serialize;
use tokio::sync::Mutex as AsyncMutex;

use super::{DesktopDiagnosticsSupervisorStateV1, DiagnosticsCollectorSupervisor};

// A collector generation remembers a small fixed history for each process
// role. Exhaustion fails closed rather than allowing an old boot to replay.
const MAX_TERMINAL_BOOTS_PER_SLOT: usize = 8;
const TERMINAL_CONTROL_WRITE_TIMEOUT: Duration = Duration::from_millis(100);

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
    anyharness: TerminalSlot,
    desktop_worker: TerminalSlot,
}

struct TerminalSlot {
    entries: [Option<TerminalEntry>; MAX_TERMINAL_BOOTS_PER_SLOT],
}

struct TerminalEntry {
    binding: TerminalBinding,
    attempt_started: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct TerminalBinding {
    collector_boot_id: String,
    generation: u64,
    producer_boot_id: String,
}

struct TerminalReservation<'a> {
    owner: &'a TerminalControlState,
    slot: TerminalProducerSlot,
    binding: TerminalBinding,
    attempt_started: bool,
}

struct AmbiguousWriteGuard<'a> {
    writer_ambiguous: &'a AtomicBool,
    recorded: bool,
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

impl Default for TerminalSlot {
    fn default() -> Self {
        Self {
            entries: std::array::from_fn(|_| None),
        }
    }
}

impl TerminalSlot {
    fn contains_producer_boot(&self, producer_boot_id: &str) -> bool {
        self.entries
            .iter()
            .flatten()
            .any(|entry| entry.binding.producer_boot_id == producer_boot_id)
    }

    fn reserve(&mut self, binding: TerminalBinding) -> Result<(), TerminalControlOutcome> {
        if self.entries.iter().flatten().any(|entry| {
            entry.binding == binding || entry.binding.producer_boot_id == binding.producer_boot_id
        }) {
            return Err(TerminalControlOutcome::Ambiguous);
        }
        let entry = self
            .entries
            .iter_mut()
            .find(|entry| entry.is_none())
            .ok_or(TerminalControlOutcome::Ambiguous)?;
        *entry = Some(TerminalEntry {
            binding,
            attempt_started: false,
        });
        Ok(())
    }

    fn begin_attempt(&mut self, binding: &TerminalBinding) -> Result<(), TerminalControlOutcome> {
        let entry = self
            .entries
            .iter_mut()
            .flatten()
            .find(|entry| &entry.binding == binding)
            .ok_or(TerminalControlOutcome::Unavailable)?;
        if entry.attempt_started {
            return Err(TerminalControlOutcome::Ambiguous);
        }
        entry.attempt_started = true;
        Ok(())
    }

    fn release_pre_write(&mut self, binding: &TerminalBinding) {
        if let Some(entry) = self.entries.iter_mut().find(|entry| {
            entry
                .as_ref()
                .is_some_and(|entry| &entry.binding == binding && !entry.attempt_started)
        }) {
            *entry = None;
        }
    }
}

impl TerminalSlots {
    fn contains_producer_boot(&self, producer_boot_id: &str) -> bool {
        self.anyharness.contains_producer_boot(producer_boot_id)
            || self.desktop_worker.contains_producer_boot(producer_boot_id)
    }

    fn slot_mut(&mut self, slot: TerminalProducerSlot) -> &mut TerminalSlot {
        match slot {
            TerminalProducerSlot::AnyHarness => &mut self.anyharness,
            TerminalProducerSlot::DesktopWorker => &mut self.desktop_worker,
        }
    }
}

impl<'a> TerminalReservation<'a> {
    fn begin_attempt(&mut self) -> Result<(), TerminalControlOutcome> {
        let mut slots = self
            .owner
            .slots
            .lock()
            .map_err(|_| TerminalControlOutcome::Unavailable)?;
        slots.slot_mut(self.slot).begin_attempt(&self.binding)?;
        self.attempt_started = true;
        Ok(())
    }
}

impl<'a> Drop for TerminalReservation<'a> {
    fn drop(&mut self) {
        if self.attempt_started {
            return;
        }
        if let Ok(mut slots) = self.owner.slots.lock() {
            slots.slot_mut(self.slot).release_pre_write(&self.binding);
        }
    }
}

impl<'a> AmbiguousWriteGuard<'a> {
    fn recorded(&mut self) {
        self.recorded = true;
    }
}

impl<'a> Drop for AmbiguousWriteGuard<'a> {
    fn drop(&mut self) {
        if !self.recorded {
            self.writer_ambiguous.store(true, Ordering::Release);
        }
    }
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
    fn reserve_if_current<'a>(
        &'a self,
        slot: TerminalProducerSlot,
        expected_collector_boot_id: &str,
        expected_generation: u64,
        producer_boot_id: &str,
        current: Option<TerminalCollectorView<'_>>,
    ) -> Result<TerminalReservation<'a>, TerminalControlOutcome> {
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
        if slots.contains_producer_boot(producer_boot_id) {
            return Err(TerminalControlOutcome::Ambiguous);
        }
        slots.slot_mut(slot).reserve(binding.clone())?;
        Ok(TerminalReservation {
            owner: self,
            slot,
            binding,
            attempt_started: false,
        })
    }

    async fn dispatch<'a, W, F>(
        &'a self,
        reservation: TerminalReservation<'a>,
        command: Vec<u8>,
        write: W,
    ) -> TerminalControlOutcome
    where
        W: FnOnce(Vec<u8>) -> F,
        F: Future<Output = Result<(), io::Error>>,
    {
        self.dispatch_until(
            reservation,
            command,
            tokio::time::Instant::now() + TERMINAL_CONTROL_WRITE_TIMEOUT,
            write,
        )
        .await
    }

    async fn dispatch_with_timeout<'a, W, F>(
        &'a self,
        reservation: TerminalReservation<'a>,
        command: Vec<u8>,
        timeout: Duration,
        write: W,
    ) -> TerminalControlOutcome
    where
        W: FnOnce(Vec<u8>) -> F,
        F: Future<Output = Result<(), io::Error>>,
    {
        self.dispatch_until(
            reservation,
            command,
            tokio::time::Instant::now() + timeout,
            write,
        )
        .await
    }

    async fn dispatch_until<'a, W, F>(
        &'a self,
        mut reservation: TerminalReservation<'a>,
        command: Vec<u8>,
        deadline: tokio::time::Instant,
        write: W,
    ) -> TerminalControlOutcome
    where
        W: FnOnce(Vec<u8>) -> F,
        F: Future<Output = Result<(), io::Error>>,
    {
        if tokio::time::Instant::now() >= deadline {
            return TerminalControlOutcome::Unavailable;
        }
        let _writer = match tokio::time::timeout_at(deadline, self.writer.lock()).await {
            Ok(writer) => writer,
            Err(_) => return TerminalControlOutcome::Unavailable,
        };
        if tokio::time::Instant::now() >= deadline {
            return TerminalControlOutcome::Unavailable;
        }
        if self.writer_ambiguous.load(Ordering::Acquire) {
            return TerminalControlOutcome::Ambiguous;
        }
        if let Err(outcome) = reservation.begin_attempt() {
            return outcome;
        }
        let mut ambiguity = AmbiguousWriteGuard {
            writer_ambiguous: &self.writer_ambiguous,
            recorded: false,
        };
        match tokio::time::timeout_at(deadline, write(command)).await {
            Ok(Ok(())) => {
                ambiguity.recorded();
                TerminalControlOutcome::Recorded
            }
            Ok(Err(_)) | Err(_) => TerminalControlOutcome::Ambiguous,
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

    /// Collector shutdown takes this same gate before writing its control
    /// line, so a reserved producer-death command cannot interleave with it.
    pub(super) async fn lock_writer(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.writer.lock().await
    }
}

impl DiagnosticsCollectorSupervisor {
    #[cfg(test)]
    pub(crate) async fn hold_lifecycle_decision_for_test(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.decisions.lock().await
    }

    pub(crate) async fn send_producer_dead_if_current(
        &self,
        slot: TerminalProducerSlot,
        expected_collector_boot_id: &str,
        expected_generation: u64,
        producer_boot_id: &str,
        deadline: tokio::time::Instant,
    ) -> TerminalControlOutcome {
        if tokio::time::Instant::now() >= deadline {
            return TerminalControlOutcome::Unavailable;
        }
        let command = match typed_producer_dead_command(producer_boot_id) {
            Ok(command) => command,
            Err(_) => return TerminalControlOutcome::Unavailable,
        };
        // The async lifecycle mutex keeps the validated collector generation
        // stable through the bounded write. The synchronous inner mutex below
        // is released before any await on the control writer.
        let _decision = match tokio::time::timeout_at(deadline, self.decisions.lock()).await {
            Ok(decision) => decision,
            Err(_) => return TerminalControlOutcome::Unavailable,
        };
        let (reservation, mut control) = {
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
            let descriptor = match process.duplicate_terminal_control_descriptor() {
                Ok(descriptor) => descriptor,
                Err(_) => return TerminalControlOutcome::Unavailable,
            };
            let control =
                match super::OwnedCollectorProcess::prepare_terminal_control_stream(descriptor) {
                    Ok(control) => control,
                    Err(_) => return TerminalControlOutcome::Unavailable,
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
            (reservation, control)
        };
        self.terminal_control
            .dispatch_until(reservation, command, deadline, move |command| async move {
                super::OwnedCollectorProcess::write_terminal_control_line(&mut control, &command)
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
#[path = "terminal_control_deadline_tests.rs"]
mod deadline_tests;
#[cfg(test)]
#[path = "terminal_control_tests.rs"]
mod tests;
