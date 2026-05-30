use std::collections::HashMap;
use std::io::Write as IoWrite;
use std::path::PathBuf;
use std::sync::Arc;

use portable_pty::{MasterPty, PtySize};
use tokio::sync::{broadcast, Mutex, RwLock};

use crate::domains::terminals::model::{
    ResizeTerminalOptions, RunTerminalCommandOptions, ShellKind, TerminalCommandRunRecord,
    TerminalOutputEvent, TerminalPurpose, TerminalRecord, TerminalStatus,
};
use crate::domains::terminals::service::TerminalCommandService;

use super::output_sink::TerminalOutputHub;
use super::pty_command;
use super::pty_command::ActivePtyCommand;

pub(super) type PtyHandleRef = Arc<Mutex<PtyHandle>>;
pub(super) type TerminalRegistry = Arc<RwLock<HashMap<String, PtyHandleRef>>>;
pub(super) type TerminalOutputRegistry = Arc<RwLock<HashMap<String, TerminalOutputHub>>>;

#[derive(Clone)]
pub struct TerminalHandle {
    terminal_id: String,
    pty: PtyHandleRef,
    registry: TerminalRegistry,
    output_hubs: TerminalOutputRegistry,
    command_service: TerminalCommandService,
    runtime_home: PathBuf,
}

impl TerminalHandle {
    pub(super) fn new(
        terminal_id: String,
        pty: PtyHandleRef,
        registry: TerminalRegistry,
        output_hubs: TerminalOutputRegistry,
        command_service: TerminalCommandService,
        runtime_home: PathBuf,
    ) -> Self {
        Self {
            terminal_id,
            pty,
            registry,
            output_hubs,
            command_service,
            runtime_home,
        }
    }

    pub fn id(&self) -> &str {
        &self.terminal_id
    }

    pub async fn snapshot(&self) -> anyhow::Result<TerminalRecord> {
        let handle = self.current_pty().await?;
        let h = handle.lock().await;
        Ok(h.record_with_latest_command_run(&self.command_service))
    }

    pub async fn update_title(&self, title: String) -> anyhow::Result<TerminalRecord> {
        let handle = self.current_pty().await?;
        let mut h = handle.lock().await;
        Ok(h.update_title(title, &self.command_service))
    }

    pub async fn run_command(
        &self,
        request: RunTerminalCommandOptions,
    ) -> anyhow::Result<TerminalCommandRunRecord> {
        pty_command::run_terminal_command(
            &self.registry,
            &self.command_service,
            &self.runtime_home,
            &self.terminal_id,
            request,
        )
        .await
    }

    pub async fn write_input(&self, data: &[u8]) -> anyhow::Result<()> {
        let handle = self.current_pty().await?;
        let mut h = handle.lock().await;
        if h.record.purpose == TerminalPurpose::Setup
            && self
                .command_service
                .is_setup_running(&h.record.workspace_id)
        {
            anyhow::bail!("setup terminal input is blocked while setup is running");
        }
        h.write_input(data)
    }

    pub async fn resize(&self, request: ResizeTerminalOptions) -> anyhow::Result<TerminalRecord> {
        let handle = self.current_pty().await?;
        let mut h = handle.lock().await;
        h.resize(request, &self.command_service)
    }

    pub async fn close(&self) -> anyhow::Result<()> {
        let handle = self.current_pty().await?;
        {
            let h = handle.lock().await;
            if h.record.purpose == TerminalPurpose::Setup
                && self
                    .command_service
                    .is_setup_running(&h.record.workspace_id)
            {
                anyhow::bail!("cannot close setup terminal while setup is running");
            }
        }

        let removed = {
            let mut map = self.registry.write().await;
            match map.get(&self.terminal_id) {
                Some(current) if Arc::ptr_eq(current, &handle) => map.remove(&self.terminal_id),
                _ => None,
            }
        };
        let Some(removed) = removed else {
            anyhow::bail!("terminal not found");
        };
        {
            let mut h = removed.lock().await;
            h.kill();
        }
        {
            let mut hubs = self.output_hubs.write().await;
            hubs.remove(&self.terminal_id);
        }
        Ok(())
    }

    pub async fn subscribe_output(
        &self,
        after_seq: Option<u64>,
    ) -> Option<(
        Vec<TerminalOutputEvent>,
        broadcast::Receiver<TerminalOutputEvent>,
    )> {
        if self.current_pty().await.is_err() {
            return None;
        }
        let hub = {
            let hubs = self.output_hubs.read().await;
            hubs.get(&self.terminal_id).cloned()
        }?;
        let replay = hub.replay(after_seq.unwrap_or(0)).await;
        Some((replay, hub.sender.subscribe()))
    }

    async fn current_pty(&self) -> anyhow::Result<PtyHandleRef> {
        let map = self.registry.read().await;
        match map.get(&self.terminal_id) {
            Some(current) if Arc::ptr_eq(current, &self.pty) => Ok(current.clone()),
            _ => anyhow::bail!("terminal not found"),
        }
    }
}

pub(super) struct PtyHandle {
    pub(super) record: TerminalRecord,
    pub(super) _shell_path: String,
    pub(super) shell_kind: ShellKind,
    pub(super) master: Box<dyn MasterPty + Send>,
    pub(super) writer: Box<dyn IoWrite + Send>,
    pub(super) child: Box<dyn portable_pty::Child + Send>,
    pub(super) active_pty_command: Option<ActivePtyCommand>,
}

impl PtyHandle {
    pub(super) fn record_with_latest_command_run(
        &self,
        command_service: &TerminalCommandService,
    ) -> TerminalRecord {
        let mut record = self.record.clone();
        record.command_run = command_service
            .latest_command_run_for_terminal(&record.id)
            .ok()
            .flatten();
        record
    }

    pub(super) fn update_title(
        &mut self,
        title: String,
        command_service: &TerminalCommandService,
    ) -> TerminalRecord {
        self.record.title = title;
        self.record.updated_at = chrono::Utc::now().to_rfc3339();
        self.record_with_latest_command_run(command_service)
    }

    pub(super) fn set_command_run(&mut self, run: TerminalCommandRunRecord) {
        self.record.command_run = Some(run);
        self.record.updated_at = chrono::Utc::now().to_rfc3339();
    }

    pub(super) fn write_input(&mut self, data: &[u8]) -> anyhow::Result<()> {
        self.writer
            .write_all(data)
            .map_err(|e| anyhow::anyhow!("write failed: {e}"))?;
        self.writer
            .flush()
            .map_err(|e| anyhow::anyhow!("flush failed: {e}"))?;
        Ok(())
    }

    pub(super) fn resize(
        &mut self,
        request: ResizeTerminalOptions,
        command_service: &TerminalCommandService,
    ) -> anyhow::Result<TerminalRecord> {
        self.master.resize(PtySize {
            rows: request.rows,
            cols: request.cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        self.record.updated_at = chrono::Utc::now().to_rfc3339();
        Ok(self.record_with_latest_command_run(command_service))
    }

    pub(super) fn kill(&mut self) {
        let _ = self.child.kill();
    }

    pub(super) fn mark_exited(&mut self) {
        let code = self
            .child
            .try_wait()
            .ok()
            .flatten()
            .map(|status| if status.success() { 0 } else { 1 });
        self.record.status = TerminalStatus::Exited;
        self.record.exit_code = code;
        self.record.updated_at = chrono::Utc::now().to_rfc3339();
    }
}
