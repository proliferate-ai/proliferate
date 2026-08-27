//! T-12: the conservative orphan sweep.

use super::super::*;
use super::*;

// ---------------------------------------------------------------------------
// T-12: the conservative orphan sweep
// ---------------------------------------------------------------------------

/// T-12 — the sweep removes ONLY roots that are both abandoned AND old.
///
/// Five roots: (a) our own pid, (b) a live foreign pid, (c) a dead pid with a fresh
/// timestamp, (d) a dead pid older than the age bound, (e) an unparseable name with
/// an old mtime. Only (d) and (e) may go. An unconditional sweep would remove all
/// five, which is the data-loss case: it would delete another runtime's in-flight
/// probe config mid-spawn.
#[test]
fn the_sweep_removes_only_abandoned_and_old_scratch_roots() {
    let home = TempHome::new("sweep");
    let probe_dir = home.path().join("agent-auth-probe");
    std::fs::create_dir_all(&probe_dir).expect("create probe dir");
    std::fs::create_dir_all(home.path().join("agent-auth")).expect("create live dir");
    std::fs::write(home.path().join("agent-auth/state.json"), b"{}").expect("seed state");

    let now_nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let max_age = std::time::Duration::from_secs(720);
    let old_nanos = now_nanos - (max_age.as_nanos() * 2);

    // A real live foreign process, so (b) is not a fiction.
    let mut live_child = std::process::Command::new("sleep")
        .arg("30")
        .spawn()
        .expect("spawn a live foreign process");
    let live_pid = live_child.id();
    // A pid that is definitely dead: spawn and reap.
    let mut dead_child = std::process::Command::new("true")
        .spawn()
        .expect("spawn a short-lived process");
    let dead_pid = dead_child.id();
    dead_child.wait().expect("reap");

    let own = probe_dir.join(format!("claude-gateway-{}-{old_nanos}", std::process::id()));
    let live = probe_dir.join(format!("codex-gateway-{live_pid}-{old_nanos}"));
    let dead_fresh = probe_dir.join(format!("grok-gateway-{dead_pid}-{now_nanos}"));
    let dead_old = probe_dir.join(format!("opencode-gateway-{dead_pid}-{old_nanos}"));
    let unparseable = probe_dir.join("not-a-scratch-name");
    for root in [&own, &live, &dead_fresh, &dead_old, &unparseable] {
        std::fs::create_dir_all(root).expect("create scratch root");
    }
    // Age the unparseable dir past the bound via its mtime. Creating it and
    // asserting on `elapsed()` requires a real clock gap, so instead set the mtime
    // explicitly where the platform allows it; when it does not, skip that leg.
    let unparseable_aged = set_dir_mtime_back(&unparseable, max_age * 2);

    let removed = sweep_probe_scratch(home.path(), max_age);

    assert!(own.is_dir(), "our own pid's scratch must survive");
    assert!(live.is_dir(), "a live foreign pid's scratch must survive");
    assert!(
        dead_fresh.is_dir(),
        "a dead pid's FRESH scratch must survive the age gate"
    );
    assert!(
        !dead_old.exists(),
        "a dead pid's old scratch must be removed"
    );
    assert!(removed.contains(&dead_old));
    if unparseable_aged {
        assert!(
            !unparseable.exists(),
            "an unparseable old-mtime dir must be removed"
        );
    } else {
        assert!(
            unparseable.is_dir(),
            "without a settable mtime the unparseable dir is too young to remove"
        );
    }
    assert!(
        home.path().join("agent-auth/state.json").exists(),
        "the sweep must never touch the live agent-auth root"
    );

    let _ = live_child.kill();
    let _ = live_child.wait();
}

/// Best-effort: move a directory's mtime back so the age gate can be exercised
/// without sleeping. Returns false when the platform refuses, so the caller can
/// assert the other direction instead of silently passing.
fn set_dir_mtime_back(path: &Path, by: std::time::Duration) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    let Ok(modified) = metadata.modified() else {
        return false;
    };
    let Some(target) = modified.checked_sub(by) else {
        return false;
    };
    let seconds = match target.duration_since(std::time::UNIX_EPOCH) {
        Ok(duration) => duration.as_secs() as i64,
        Err(_) => return false,
    };
    let output = std::process::Command::new("touch")
        .arg("-t")
        .arg(format_touch_stamp(seconds))
        .arg(path)
        .output();
    matches!(output, Ok(output) if output.status.success())
}

/// `touch -t` wants `[[CC]YY]MMDDhhmm[.ss]`.
fn format_touch_stamp(unix_seconds: i64) -> String {
    let time = chrono::DateTime::from_timestamp(unix_seconds, 0).unwrap_or_default();
    time.format("%Y%m%d%H%M.%S").to_string()
}
