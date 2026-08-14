use std::fs::File;
use std::io::Write;
use std::os::fd::{FromRawFd, OwnedFd};
use std::time::{Duration, Instant};

use super::*;

const SHORT_DEADLINE: Duration = Duration::from_millis(50);
const TEST_SCHEDULING_MARGIN: Duration = Duration::from_millis(750);

fn pipe_pair() -> (OwnedFd, OwnedFd) {
    let mut descriptors = [0_i32; 2];
    assert_eq!(unsafe { libc::pipe(descriptors.as_mut_ptr()) }, 0);
    unsafe {
        (
            OwnedFd::from_raw_fd(descriptors[0]),
            OwnedFd::from_raw_fd(descriptors[1]),
        )
    }
}

fn read_with_short_deadline(read_end: OwnedFd) -> (Result<String, ()>, Duration) {
    let started = Instant::now();
    let result = read_capability_until(read_end, started + SHORT_DEADLINE);
    (result, started.elapsed())
}

fn assert_wait_was_bounded(elapsed: Duration) {
    assert!(
        elapsed < TEST_SCHEDULING_MARGIN,
        "capability read exceeded its bounded scheduling margin: {elapsed:?}"
    );
}

#[test]
fn eof_completes_a_graphic_capability() {
    let (read_end, write_end) = pipe_pair();
    let mut writer = File::from(write_end);
    writer.write_all(b"capability-token-1").expect("write");
    drop(writer);

    let value = read_capability_until(read_end, Instant::now() + SHORT_DEADLINE)
        .expect("EOF-complete capability");
    assert_eq!(value, "capability-token-1");
}

#[test]
fn exact_256_byte_capability_plus_newline_completes_while_writer_stays_open() {
    let (read_end, write_end) = pipe_pair();
    let mut writer = File::from(write_end);
    let mut bytes = vec![b'a'; MAX_CAPABILITY_BYTES];
    bytes.push(b'\n');
    writer.write_all(&bytes).expect("write");

    let started = Instant::now();
    let value = read_capability_until(read_end, started + SHORT_DEADLINE)
        .expect("newline-complete capability");
    assert_eq!(value.len(), MAX_CAPABILITY_BYTES);
    assert!(value.bytes().all(|byte| byte == b'a'));
    assert_wait_was_bounded(started.elapsed());
    drop(writer);
}

#[test]
fn two_hundred_fifty_seven_graphic_bytes_are_rejected_without_waiting_for_eof() {
    let (read_end, write_end) = pipe_pair();
    let mut writer = File::from(write_end);
    writer
        .write_all(&vec![b'a'; MAX_CAPABILITY_CHANNEL_BYTES])
        .expect("write");

    let started = Instant::now();
    assert!(
        read_capability_until(read_end, started + SHORT_DEADLINE).is_err(),
        "257 graphic bytes must be oversized"
    );
    assert_wait_was_bounded(started.elapsed());
    drop(writer);
}

#[test]
fn partial_bytes_held_open_time_out_at_the_single_absolute_deadline() {
    let (read_end, write_end) = pipe_pair();
    let mut writer = File::from(write_end);
    writer.write_all(b"partial-token").expect("write");

    // The writer stays owned by this thread. No helper thread or join can
    // outlive the deadline and hide an otherwise blocking read.
    let (result, elapsed) = read_with_short_deadline(read_end);
    assert!(result.is_err());
    assert!(elapsed >= SHORT_DEADLINE.saturating_sub(Duration::from_millis(5)));
    assert_wait_was_bounded(elapsed);
    drop(writer);
}

#[test]
fn stalled_writer_times_out_without_a_thread_or_join() {
    let (read_end, write_end) = pipe_pair();

    // Holding the unused writer in this stack frame prevents EOF while the
    // synchronous reader proves its own poll deadline is sufficient.
    let (result, elapsed) = read_with_short_deadline(read_end);
    assert!(result.is_err());
    assert!(elapsed >= SHORT_DEADLINE.saturating_sub(Duration::from_millis(5)));
    assert_wait_was_bounded(elapsed);
    drop(write_end);
}

#[test]
fn empty_and_non_graphic_capabilities_are_rejected() {
    let (empty_read, empty_write) = pipe_pair();
    drop(empty_write);
    assert!(read_capability_until(empty_read, Instant::now() + SHORT_DEADLINE).is_err());

    let (non_graphic_read, non_graphic_write) = pipe_pair();
    let mut writer = File::from(non_graphic_write);
    writer.write_all(b"has\x00nul").expect("write");
    assert!(read_capability_until(non_graphic_read, Instant::now() + SHORT_DEADLINE).is_err());
    drop(writer);
}
