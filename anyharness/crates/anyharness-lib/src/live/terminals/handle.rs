use std::collections::HashMap;
use std::io::Write as IoWrite;
use std::sync::Arc;

use portable_pty::{MasterPty, PtySize};
use tokio::sync::{Mutex, RwLock};

use crate::domains::terminals::model::{
    ResizeTerminalOptions, ShellKind, TerminalCommandRunRecord, TerminalRecord, TerminalStatus,
};
use crate::domains::terminals::service::TerminalCommandService;

use super::pty_command::ActivePtyCommand;

pub(super) type TerminalHandle = Arc<Mutex<PtyHandle>>;
pub(super) type TerminalRegistry = Arc<RwLock<HashMap<String, TerminalHandle>>>;

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
