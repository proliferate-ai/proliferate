use std::collections::VecDeque;

use super::output_sink::TerminalOutputEvent;

const MAX_REPLAY_BYTES: usize = 1024 * 1024;
const MAX_REPLAY_FRAMES: usize = 5_000;

pub(super) struct ReplayBuffer {
    pub(super) frames: VecDeque<TerminalOutputEvent>,
    pub(super) next_seq: u64,
    pub(super) byte_len: usize,
    pub(super) floor_seq: u64,
}

impl ReplayBuffer {
    pub(super) fn new() -> Self {
        Self {
            frames: VecDeque::new(),
            next_seq: 1,
            byte_len: 0,
            floor_seq: 1,
        }
    }

    pub(super) fn push(&mut self, event: TerminalOutputEvent) {
        self.byte_len += event.approx_bytes();
        self.frames.push_back(event);
        while self.byte_len > MAX_REPLAY_BYTES || self.frames.len() > MAX_REPLAY_FRAMES {
            if let Some(front) = self.frames.pop_front() {
                self.byte_len = self.byte_len.saturating_sub(front.approx_bytes());
                if let Some(seq) = front.seq() {
                    self.floor_seq = seq + 1;
                }
            } else {
                break;
            }
        }
    }
}
