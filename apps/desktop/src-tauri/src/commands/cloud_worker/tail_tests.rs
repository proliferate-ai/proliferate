use tokio::io::{duplex, AsyncWriteExt};

use super::tail::{
    drain_worker_stream, SharedWorkerTail, WorkerOutputStream, WORKER_TAIL_MAX_BYTES,
    WORKER_TAIL_MAX_LINES,
};

#[test]
fn interleaved_streams_receive_deterministic_observation_ordinals() {
    let tail = SharedWorkerTail::new();
    tail.ingest(WorkerOutputStream::Stdout, b"out-1\n");
    tail.ingest(WorkerOutputStream::Stderr, b"err-1\n");
    tail.ingest(WorkerOutputStream::Stdout, b"out-2\n");
    tail.finish_stream(WorkerOutputStream::Stdout);
    tail.finish_stream(WorkerOutputStream::Stderr);

    let snapshot = tail.snapshot();
    assert_eq!(
        snapshot
            .lines
            .iter()
            .map(|line| (line.ordinal, line.stream, line.text.as_str()))
            .collect::<Vec<_>>(),
        vec![
            (0, WorkerOutputStream::Stdout, "out-1"),
            (1, WorkerOutputStream::Stderr, "err-1"),
            (2, WorkerOutputStream::Stdout, "out-2"),
        ]
    );
    assert!(!snapshot.tail_incomplete);
}

#[test]
fn split_utf8_is_decoded_only_after_crlf_finalization() {
    let tail = SharedWorkerTail::new();
    tail.ingest(WorkerOutputStream::Stdout, b"caf\xc3");
    assert!(tail.snapshot().lines.is_empty());
    tail.ingest(WorkerOutputStream::Stdout, b"\xa9\r");
    assert!(tail.snapshot().lines.is_empty());
    tail.ingest(WorkerOutputStream::Stdout, b"\n");
    tail.finish_stream(WorkerOutputStream::Stdout);
    tail.finish_stream(WorkerOutputStream::Stderr);

    let snapshot = tail.snapshot();
    assert_eq!(snapshot.lines.len(), 1);
    assert_eq!(snapshot.lines[0].text, "café");
    assert!(!snapshot.lines[0].truncated_prefix);
}

#[test]
fn invalid_utf8_is_replaced_at_line_finalization() {
    let tail = SharedWorkerTail::new();
    tail.ingest(WorkerOutputStream::Stderr, b"left\xffright\n");
    tail.finish_stream(WorkerOutputStream::Stdout);
    tail.finish_stream(WorkerOutputStream::Stderr);

    assert_eq!(tail.snapshot().lines[0].text, "left\u{fffd}right");
}

#[test]
fn eof_finalizes_non_empty_partial_but_not_an_empty_stream() {
    let tail = SharedWorkerTail::new();
    tail.ingest(WorkerOutputStream::Stderr, b"last line without newline");
    tail.finish_stream(WorkerOutputStream::Stdout);
    tail.finish_stream(WorkerOutputStream::Stderr);

    let snapshot = tail.snapshot();
    assert_eq!(snapshot.lines.len(), 1);
    assert_eq!(snapshot.lines[0].stream, WorkerOutputStream::Stderr);
    assert_eq!(snapshot.lines[0].text, "last line without newline");
}

#[test]
fn empty_newline_is_a_finalized_line() {
    let tail = SharedWorkerTail::new();
    tail.ingest(WorkerOutputStream::Stdout, b"\n\r\n");
    tail.finish_stream(WorkerOutputStream::Stdout);
    tail.finish_stream(WorkerOutputStream::Stderr);

    let snapshot = tail.snapshot();
    assert_eq!(snapshot.lines.len(), 2);
    assert!(snapshot.lines.iter().all(|line| line.text.is_empty()));
}

#[test]
fn arbitrarily_long_no_newline_output_keeps_only_a_bounded_newest_suffix() {
    let tail = SharedWorkerTail::new();
    let mut output = vec![b'a'; WORKER_TAIL_MAX_BYTES * 4];
    output.extend_from_slice(b"newest-suffix");
    tail.ingest(WorkerOutputStream::Stdout, &output);

    let partial_snapshot = tail.snapshot();
    assert!(partial_snapshot.lines.is_empty());
    assert!(partial_snapshot.accounted_bytes <= WORKER_TAIL_MAX_BYTES);

    tail.finish_stream(WorkerOutputStream::Stdout);
    tail.finish_stream(WorkerOutputStream::Stderr);
    let snapshot = tail.snapshot();
    assert_eq!(snapshot.lines.len(), 1);
    assert!(snapshot.lines[0].truncated_prefix);
    assert!(snapshot.lines[0].text.ends_with("newest-suffix"));
    assert!(snapshot.accounted_bytes <= WORKER_TAIL_MAX_BYTES);
    assert!(snapshot.render().starts_with("[stdout] [truncated] "));
}

#[test]
fn oldest_finalized_lines_are_evicted_at_the_shared_line_cap() {
    let tail = SharedWorkerTail::new();
    for index in 0..20 {
        tail.ingest(
            WorkerOutputStream::Stdout,
            format!("line-{index}\n").as_bytes(),
        );
    }
    tail.finish_stream(WorkerOutputStream::Stdout);
    tail.finish_stream(WorkerOutputStream::Stderr);

    let snapshot = tail.snapshot();
    assert_eq!(snapshot.lines.len(), WORKER_TAIL_MAX_LINES);
    assert_eq!(
        snapshot.lines.first().expect("first retained").text,
        "line-8"
    );
    assert_eq!(
        snapshot.lines.last().expect("last retained").text,
        "line-19"
    );
    assert_eq!(snapshot.lines.first().expect("first retained").ordinal, 8);
    assert_eq!(snapshot.lines.last().expect("last retained").ordinal, 19);
}

#[test]
fn finalized_lines_and_both_partials_share_one_byte_ceiling() {
    let tail = SharedWorkerTail::new();
    let mut completed = vec![b'c'; WORKER_TAIL_MAX_BYTES / 2];
    completed.push(b'\n');
    tail.ingest(WorkerOutputStream::Stdout, &completed);
    tail.ingest(
        WorkerOutputStream::Stdout,
        &vec![b'o'; WORKER_TAIL_MAX_BYTES / 2],
    );
    tail.ingest(
        WorkerOutputStream::Stderr,
        &vec![b'e'; WORKER_TAIL_MAX_BYTES / 2],
    );

    let before_eof = tail.snapshot();
    assert!(before_eof.accounted_bytes <= WORKER_TAIL_MAX_BYTES);

    tail.finish_stream(WorkerOutputStream::Stdout);
    tail.finish_stream(WorkerOutputStream::Stderr);
    let after_eof = tail.snapshot();
    assert!(after_eof.accounted_bytes <= WORKER_TAIL_MAX_BYTES);
    assert!(after_eof.lines.len() <= WORKER_TAIL_MAX_LINES);
    assert!(after_eof.lines.iter().any(|line| line.truncated_prefix));
}

#[test]
fn cancellation_fence_finalizes_partials_and_marks_snapshot_incomplete() {
    let tail = SharedWorkerTail::new();
    tail.ingest(WorkerOutputStream::Stdout, b"observed first");
    tail.ingest(WorkerOutputStream::Stderr, b"observed second");
    tail.mark_incomplete_and_finalize();

    let snapshot = tail.snapshot();
    assert!(snapshot.tail_incomplete);
    assert_eq!(
        snapshot
            .lines
            .iter()
            .map(|line| (line.ordinal, line.stream, line.text.as_str()))
            .collect::<Vec<_>>(),
        vec![
            (0, WorkerOutputStream::Stdout, "observed first"),
            (1, WorkerOutputStream::Stderr, "observed second"),
        ]
    );
}

#[test]
fn read_failure_marks_only_one_shared_snapshot_incomplete() {
    let tail = SharedWorkerTail::new();
    tail.ingest(WorkerOutputStream::Stdout, b"before failure");
    tail.fail_stream(WorkerOutputStream::Stdout);
    tail.finish_stream(WorkerOutputStream::Stderr);

    let snapshot = tail.snapshot();
    assert!(snapshot.tail_incomplete);
    assert_eq!(snapshot.lines[0].text, "before failure");
}

#[test]
fn rendered_tail_keeps_stream_labels_and_stays_within_accounting() {
    let tail = SharedWorkerTail::new();
    tail.ingest(WorkerOutputStream::Stdout, b"one\n");
    tail.ingest(WorkerOutputStream::Stderr, b"two\n");
    tail.finish_stream(WorkerOutputStream::Stdout);
    tail.finish_stream(WorkerOutputStream::Stderr);

    let snapshot = tail.snapshot();
    assert_eq!(snapshot.render(), "[stdout] one\n[stderr] two");
    assert!(snapshot.render().len() <= snapshot.accounted_bytes);
}

#[tokio::test]
async fn async_drainer_uses_pipe_bytes_and_finalizes_at_eof() {
    let (mut writer, reader) = duplex(16);
    let tail = SharedWorkerTail::new();
    let drainer_tail = tail.clone();
    let drainer = tokio::spawn(async move {
        drain_worker_stream(reader, WorkerOutputStream::Stdout, drainer_tail).await
    });

    writer
        .write_all(b"first\npartial")
        .await
        .expect("write fixture output");
    drop(writer);
    drainer
        .await
        .expect("join drainer")
        .expect("drain fixture output");
    tail.finish_stream(WorkerOutputStream::Stderr);

    let snapshot = tail.snapshot();
    assert_eq!(
        snapshot
            .lines
            .iter()
            .map(|line| line.text.as_str())
            .collect::<Vec<_>>(),
        vec!["first", "partial"]
    );
    assert!(!snapshot.tail_incomplete);
}
