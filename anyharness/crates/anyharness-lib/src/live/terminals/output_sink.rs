use std::sync::Arc;

use tokio::sync::{broadcast, Mutex};

use crate::domains::terminals::model::TerminalOutputEvent;

use super::replay::ReplayBuffer;

#[derive(Clone)]
pub(super) struct TerminalOutputHub {
    pub(super) sender: broadcast::Sender<TerminalOutputEvent>,
    replay: Arc<Mutex<ReplayBuffer>>,
}

impl TerminalOutputHub {
    pub(super) fn new() -> Self {
        let (sender, _) = broadcast::channel(512);
        Self {
            sender,
            replay: Arc::new(Mutex::new(ReplayBuffer::new())),
        }
    }

    pub(super) async fn replay(&self, after_seq: u64) -> Vec<TerminalOutputEvent> {
        let replay = self.replay.lock().await;
        let mut frames = Vec::new();
        if after_seq > 0 && after_seq < replay.floor_seq.saturating_sub(1) {
            frames.push(TerminalOutputEvent::ReplayGap {
                requested_after_seq: after_seq,
                floor_seq: replay.floor_seq,
            });
        }
        frames.extend(replay.frames.iter().filter_map(|frame| {
            let seq = frame.seq()?;
            (seq > after_seq).then(|| frame.clone())
        }));
        frames
    }

    pub(super) async fn emit_data(
        &self,
        data: Vec<u8>,
        stream: Option<&'static str>,
        command_run_id: Option<String>,
    ) -> anyhow::Result<()> {
        if data.is_empty() {
            return Ok(());
        }
        let event = {
            let mut replay = self.replay.lock().await;
            let seq = replay.next_seq;
            replay.next_seq += 1;
            let event = TerminalOutputEvent::Data {
                seq,
                data,
                stream,
                command_run_id,
            };
            replay.push(event.clone());
            event
        };
        let _ = self.sender.send(event);
        Ok(())
    }

    pub(super) async fn emit_exit(&self, code: Option<i32>) -> anyhow::Result<()> {
        let event = {
            let mut replay = self.replay.lock().await;
            let seq = replay.next_seq;
            replay.next_seq += 1;
            let event = TerminalOutputEvent::Exit { seq, code };
            replay.push(event.clone());
            event
        };
        let _ = self.sender.send(event);
        Ok(())
    }
}

impl TerminalOutputEvent {
    pub(super) fn seq(&self) -> Option<u64> {
        match self {
            TerminalOutputEvent::Data { seq, .. } | TerminalOutputEvent::Exit { seq, .. } => {
                Some(*seq)
            }
            TerminalOutputEvent::ReplayGap { .. } => None,
        }
    }

    pub(super) fn approx_bytes(&self) -> usize {
        match self {
            TerminalOutputEvent::Data { data, .. } => data.len(),
            TerminalOutputEvent::Exit { .. } => 32,
            TerminalOutputEvent::ReplayGap { .. } => 32,
        }
    }
}
