use std::{
    collections::VecDeque,
    io,
    sync::{Arc, Mutex, MutexGuard},
};

use tokio::io::{AsyncRead, AsyncReadExt};

pub(super) const WORKER_TAIL_READ_CHUNK_BYTES: usize = 4_096;
pub(super) const WORKER_TAIL_MAX_BYTES: usize = 65_536;
pub(super) const WORKER_TAIL_MAX_LINES: usize = 12;

const TRUNCATED_PREFIX: &str = "[truncated] ";
const FINALIZED_LINE_SEPARATOR_BYTES: usize = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum WorkerOutputStream {
    Stdout,
    Stderr,
}

impl WorkerOutputStream {
    const fn index(self) -> usize {
        match self {
            Self::Stdout => 0,
            Self::Stderr => 1,
        }
    }

    pub(super) const fn label(self) -> &'static str {
        match self {
            Self::Stdout => "[stdout] ",
            Self::Stderr => "[stderr] ",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct WorkerTailLine {
    pub(super) ordinal: u64,
    pub(super) stream: WorkerOutputStream,
    pub(super) text: String,
    pub(super) truncated_prefix: bool,
}

impl WorkerTailLine {
    fn accounted_bytes(&self) -> usize {
        self.stream.label().len()
            + self.text.len()
            + if self.truncated_prefix {
                TRUNCATED_PREFIX.len()
            } else {
                0
            }
            + FINALIZED_LINE_SEPARATOR_BYTES
    }

    fn append_rendered(&self, output: &mut String) {
        output.push_str(self.stream.label());
        if self.truncated_prefix {
            output.push_str(TRUNCATED_PREFIX);
        }
        output.push_str(&self.text);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct WorkerTailSnapshot {
    pub(super) lines: Vec<WorkerTailLine>,
    pub(super) tail_incomplete: bool,
    pub(super) accounted_bytes: usize,
}

impl WorkerTailSnapshot {
    pub(super) fn render(&self) -> String {
        let mut output = String::with_capacity(self.accounted_bytes.min(WORKER_TAIL_MAX_BYTES));
        for (index, line) in self.lines.iter().enumerate() {
            if index > 0 {
                output.push('\n');
            }
            line.append_rendered(&mut output);
        }
        output
    }
}

#[derive(Clone, Default)]
pub(super) struct SharedWorkerTail {
    inner: Arc<Mutex<WorkerTailState>>,
}

impl SharedWorkerTail {
    pub(super) fn new() -> Self {
        Self::default()
    }

    /// Ingests bytes without holding the shared lock for more than one fixed
    /// drainer-sized chunk. Production drainers pass at most one chunk; the
    /// defensive split keeps test or future callers bounded too.
    pub(super) fn ingest(&self, stream: WorkerOutputStream, bytes: &[u8]) {
        for chunk in bytes.chunks(WORKER_TAIL_READ_CHUNK_BYTES) {
            self.lock().ingest_chunk(stream, chunk);
        }
    }

    /// Finalizes a non-empty partial after an ordinary EOF. Calling this more
    /// than once is harmless.
    pub(super) fn finish_stream(&self, stream: WorkerOutputStream) {
        self.lock().finish_stream(stream, false);
    }

    /// Records a read failure and finalizes the bytes observed before it.
    pub(super) fn fail_stream(&self, stream: WorkerOutputStream) {
        self.lock().finish_stream(stream, true);
    }

    /// Called by the process owner after aborting drainers whose pipes did not
    /// reach EOF before the existing process deadline. Remaining partials are
    /// finalized under the same lock in their deterministic observation order.
    pub(super) fn mark_incomplete_and_finalize(&self) {
        self.lock().mark_incomplete_and_finalize();
    }

    pub(super) fn snapshot(&self) -> WorkerTailSnapshot {
        self.lock().snapshot()
    }

    fn lock(&self) -> MutexGuard<'_, WorkerTailState> {
        match self.inner.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                guard.tail_incomplete = true;
                guard
            }
        }
    }
}

/// Drains one Worker pipe with fixed-size reads. The read itself never holds
/// the shared tail lock, so a noisy stream cannot block its sibling on I/O.
pub(super) async fn drain_worker_stream<R>(
    mut reader: R,
    stream: WorkerOutputStream,
    tail: SharedWorkerTail,
) -> io::Result<()>
where
    R: AsyncRead + Unpin,
{
    let mut buffer = [0_u8; WORKER_TAIL_READ_CHUNK_BYTES];
    loop {
        match reader.read(&mut buffer).await {
            Ok(0) => {
                tail.finish_stream(stream);
                return Ok(());
            }
            Ok(read) => tail.ingest(stream, &buffer[..read]),
            Err(error) => {
                tail.fail_stream(stream);
                return Err(error);
            }
        }
    }
}

#[derive(Default)]
struct PartialLine {
    bytes: VecDeque<u8>,
    truncated_prefix: bool,
    last_observation: u64,
}

impl PartialLine {
    fn accounted_bytes(&self, stream: WorkerOutputStream) -> usize {
        if self.bytes.is_empty() && !self.truncated_prefix {
            return 0;
        }
        stream.label().len()
            + self.bytes.len()
            + if self.truncated_prefix {
                TRUNCATED_PREFIX.len()
            } else {
                0
            }
    }

    fn drop_prefix(&mut self, requested: usize) -> bool {
        if self.bytes.is_empty() {
            return false;
        }
        let marker_cost = if self.truncated_prefix {
            0
        } else {
            TRUNCATED_PREFIX.len()
        };
        let drop = requested.saturating_add(marker_cost).min(self.bytes.len());
        self.bytes.drain(..drop);
        self.truncated_prefix = true;
        true
    }
}

#[derive(Default)]
struct WorkerTailState {
    lines: VecDeque<WorkerTailLine>,
    partials: [PartialLine; 2],
    stream_finished: [bool; 2],
    next_line_ordinal: u64,
    next_observation: u64,
    tail_incomplete: bool,
}

impl WorkerTailState {
    fn ingest_chunk(&mut self, stream: WorkerOutputStream, chunk: &[u8]) {
        if chunk.is_empty() || self.stream_finished[stream.index()] {
            return;
        }

        let mut remaining = chunk;
        loop {
            let newline = remaining.iter().position(|byte| *byte == b'\n');
            let (segment, after) = match newline {
                Some(index) => (&remaining[..index], Some(&remaining[index + 1..])),
                None => (remaining, None),
            };

            self.observe_partial(stream, segment);
            if let Some(after_newline) = after {
                self.finalize_partial(stream, true, true);
                remaining = after_newline;
                if remaining.is_empty() {
                    break;
                }
            } else {
                break;
            }
        }
    }

    fn observe_partial(&mut self, stream: WorkerOutputStream, bytes: &[u8]) {
        let observation = self.next_observation;
        self.next_observation = self.next_observation.saturating_add(1);
        let partial = &mut self.partials[stream.index()];
        partial.last_observation = observation;
        partial.bytes.extend(bytes);
        self.enforce_limits(None);
    }

    fn finish_stream(&mut self, stream: WorkerOutputStream, incomplete: bool) {
        let index = stream.index();
        if self.stream_finished[index] {
            self.tail_incomplete |= incomplete;
            return;
        }
        self.stream_finished[index] = true;
        self.tail_incomplete |= incomplete;
        self.finalize_partial(stream, false, false);
    }

    fn mark_incomplete_and_finalize(&mut self) {
        self.tail_incomplete = true;
        let mut unfinished = [WorkerOutputStream::Stdout, WorkerOutputStream::Stderr];
        unfinished.sort_by_key(|stream| {
            let partial = &self.partials[stream.index()];
            (partial.last_observation, stream.index())
        });
        for stream in unfinished {
            if !self.stream_finished[stream.index()] {
                self.finish_stream(stream, true);
            }
        }
    }

    fn finalize_partial(
        &mut self,
        stream: WorkerOutputStream,
        strip_carriage_return: bool,
        keep_empty_line: bool,
    ) {
        let index = stream.index();
        let partial = &mut self.partials[index];
        if strip_carriage_return && partial.bytes.back() == Some(&b'\r') {
            partial.bytes.pop_back();
        }
        if partial.bytes.is_empty() && !partial.truncated_prefix && !keep_empty_line {
            return;
        }

        let raw = std::mem::take(&mut partial.bytes);
        let was_truncated = std::mem::take(&mut partial.truncated_prefix);
        let max_text_bytes = WORKER_TAIL_MAX_BYTES
            .saturating_sub(stream.label().len())
            .saturating_sub(TRUNCATED_PREFIX.len())
            .saturating_sub(FINALIZED_LINE_SEPARATOR_BYTES);
        let (text, conversion_truncated) = bounded_lossy_suffix(raw, max_text_bytes);
        let ordinal = self.next_line_ordinal;
        self.next_line_ordinal = self.next_line_ordinal.saturating_add(1);
        self.lines.push_back(WorkerTailLine {
            ordinal,
            stream,
            text,
            truncated_prefix: was_truncated || conversion_truncated,
        });
        self.enforce_limits(Some(ordinal));
    }

    fn snapshot(&self) -> WorkerTailSnapshot {
        WorkerTailSnapshot {
            lines: self.lines.iter().cloned().collect(),
            tail_incomplete: self.tail_incomplete
                || self.stream_finished.iter().any(|finished| !finished),
            accounted_bytes: self.accounted_bytes(),
        }
    }

    fn accounted_bytes(&self) -> usize {
        self.lines
            .iter()
            .map(WorkerTailLine::accounted_bytes)
            .sum::<usize>()
            + self.partials[WorkerOutputStream::Stdout.index()]
                .accounted_bytes(WorkerOutputStream::Stdout)
            + self.partials[WorkerOutputStream::Stderr.index()]
                .accounted_bytes(WorkerOutputStream::Stderr)
    }

    fn enforce_limits(&mut self, protected_ordinal: Option<u64>) {
        while self.lines.len() > WORKER_TAIL_MAX_LINES {
            self.lines.pop_front();
        }

        while self.accounted_bytes() > WORKER_TAIL_MAX_BYTES {
            if self
                .lines
                .front()
                .is_some_and(|line| Some(line.ordinal) != protected_ordinal)
            {
                self.lines.pop_front();
                continue;
            }

            let overage = self.accounted_bytes() - WORKER_TAIL_MAX_BYTES;
            if self.trim_oldest_partial(overage) {
                continue;
            }

            let Some(line) = self.lines.front_mut() else {
                break;
            };
            if !trim_line_prefix(line, overage) {
                break;
            }
        }
    }

    fn trim_oldest_partial(&mut self, requested: usize) -> bool {
        let candidate = [WorkerOutputStream::Stdout, WorkerOutputStream::Stderr]
            .into_iter()
            .filter(|stream| !self.partials[stream.index()].bytes.is_empty())
            .min_by_key(|stream| {
                let partial = &self.partials[stream.index()];
                (partial.last_observation, stream.index())
            });
        candidate.is_some_and(|stream| self.partials[stream.index()].drop_prefix(requested))
    }
}

fn trim_line_prefix(line: &mut WorkerTailLine, requested: usize) -> bool {
    if line.text.is_empty() {
        return false;
    }
    let marker_cost = if line.truncated_prefix {
        0
    } else {
        TRUNCATED_PREFIX.len()
    };
    let requested = requested.saturating_add(marker_cost).min(line.text.len());
    let mut boundary = requested;
    while boundary < line.text.len() && !line.text.is_char_boundary(boundary) {
        boundary += 1;
    }
    line.text.drain(..boundary);
    line.truncated_prefix = true;
    true
}

fn bounded_lossy_suffix(bytes: VecDeque<u8>, max_bytes: usize) -> (String, bool) {
    let bytes: Vec<u8> = bytes.into_iter().collect();
    let mut output = VecDeque::with_capacity(max_bytes.min(bytes.len().saturating_mul(3)));
    let mut truncated = false;
    let mut remaining = bytes.as_slice();

    while !remaining.is_empty() {
        match std::str::from_utf8(remaining) {
            Ok(valid) => {
                push_valid_suffix(&mut output, valid, max_bytes, &mut truncated);
                break;
            }
            Err(error) => {
                let valid_end = error.valid_up_to();
                let valid = std::str::from_utf8(&remaining[..valid_end])
                    .expect("Utf8Error valid prefix must be valid UTF-8");
                push_valid_suffix(&mut output, valid, max_bytes, &mut truncated);
                push_valid_suffix(&mut output, "\u{fffd}", max_bytes, &mut truncated);
                let invalid = error.error_len().unwrap_or(remaining.len() - valid_end);
                remaining = &remaining[valid_end.saturating_add(invalid)..];
            }
        }
    }

    let output: Vec<u8> = output.into_iter().collect();
    // Every insertion above came from a valid UTF-8 char.
    (
        String::from_utf8(output).expect("bounded lossy output must remain valid UTF-8"),
        truncated,
    )
}

fn push_valid_suffix(
    output: &mut VecDeque<u8>,
    value: &str,
    max_bytes: usize,
    truncated: &mut bool,
) {
    for character in value.chars() {
        let mut encoded = [0_u8; 4];
        let encoded = character.encode_utf8(&mut encoded).as_bytes();
        while output.len().saturating_add(encoded.len()) > max_bytes {
            let Some(first) = output.front().copied() else {
                *truncated = true;
                break;
            };
            let width = utf8_width(first);
            for _ in 0..width.min(output.len()) {
                output.pop_front();
            }
            *truncated = true;
        }
        if encoded.len() <= max_bytes {
            output.extend(encoded);
        }
    }
}

const fn utf8_width(first: u8) -> usize {
    match first {
        0x00..=0x7f => 1,
        0xc0..=0xdf => 2,
        0xe0..=0xef => 3,
        _ => 4,
    }
}
