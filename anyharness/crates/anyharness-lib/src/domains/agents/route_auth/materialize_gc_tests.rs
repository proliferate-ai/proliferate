//! The sequence-keyed home GC across the revision→sequence cutover.
//!
//! Adopted from an adversarial review, with the assertions turned around: the
//! review's version pinned the leak, this one pins the sweep.

use super::*;

struct Home(PathBuf);

impl Home {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "anyharness-gc-review-{label}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&path).expect("create home");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }

    fn codex_dirs(&self) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(route_auth_root(self.path()))
            .expect("read agent-auth root")
            .flatten()
            .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
            .filter(|name| name.starts_with(CODEX_HOME_PREFIX))
            .collect();
        names.sort();
        names
    }
}

impl Drop for Home {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn apply(home: &Home, sequence: i64) {
    apply_file_spec(
        home.path(),
        &FileSpec {
            path_family: PathFamily::CodexHome,
            sequence,
            contents: Some(b"[model_providers.proliferate]\n".to_vec()),
        },
    )
    .expect("materialize codex home");
}

/// REVIEW FINDING (regression, now fixed): the sequence-keyed GC used to sweep
/// only dirs it could order strictly BELOW the immediately-previous sequence,
/// and this slice reset the number space. On the base branch `revision` was
/// ms-epoch (`state_render.py::_row_revision`: "ms since epoch of updated_at");
/// the new `sequence` restarts at 1 (`render_sequence.py::_FIRST_SEQUENCE`). So
/// on any install that had ever materialized a routed codex / grok / opencode
/// home, the pre-cutover `codex-home-<ms-epoch>` dir was forever `>= current` —
/// the GC's own "shouldn't normally occur" branch — and was never swept again.
///
/// What leaked is not an empty dir: the `config.toml` inside it is written 0600
/// by `apply_file_spec` and carries the gateway virtual key that was live at
/// that revision. The sweep now keeps current + immediately-previous + in-space
/// above-current (see the racing-materializer test below) and reclaims
/// everything else — which is what finally sweeps the out-of-space residue.
#[test]
fn a_pre_cutover_ms_epoch_home_is_swept_after_the_sequence_reset() {
    let home = Home::new("ms-epoch-leak");

    // A pre-cutover materialization, named by the ms-epoch `revision` the
    // server used to emit, holding the 0600 config the render wrote then.
    apply(&home, 1_785_000_000_000);
    assert_eq!(home.codex_dirs(), vec!["codex-home-1785000000000"]);
    let leaked = sequence_dir_path(home.path(), CODEX_HOME_PREFIX, 1_785_000_000_000)
        .join(CODEX_CONFIG_FILE_NAME);
    assert!(leaked.exists(), "the pre-cutover config was written");

    // The cutover: every render now numbers from 1 upward. The very first
    // in-space materialization reclaims the out-of-space credential dir.
    apply(&home, 1);
    assert_eq!(
        home.codex_dirs(),
        vec!["codex-home-1"],
        "the pre-cutover credential dir is reclaimed by the first post-cutover render"
    );
    assert!(
        !leaked.exists(),
        "its 0600 config.toml — the gateway virtual key live at that revision — is gone with it"
    );

    // WITHIN one number space the sweep still behaves exactly as documented,
    // keeping current + immediately-previous and nothing older.
    for sequence in 2..=10 {
        apply(&home, sequence);
    }
    assert_eq!(
        home.codex_dirs(),
        vec!["codex-home-10".to_string(), "codex-home-9".to_string()],
        "in-space GC still retains exactly current + previous"
    );
}

/// REVIEW FINDING (regression, now fixed): the ms-epoch leak fix above briefly
/// made the sweep reclaim EVERYTHING above the current sequence — and launch
/// materialization is not serialized with the apply door (the state-file flock
/// covers only the state.json writers; `resolve_launch_route_auth[_rotated]_
/// for_server` reads state.json then calls `apply_file_spec` lock-free). Two
/// concurrent launches straddling an apply carry sequences N and N+1; if the
/// STALE one's GC ran after the fresh one's write, it deleted
/// `codex-home-<N+1>` — the dir the fresh session's env points into — taking
/// the 0600 `config.toml` the fresh session was about to read with it.
/// Parallel session starts are a real product shape (workflow lanes).
///
/// The sweep now retains in-space dirs above the current sequence (a racing
/// newer materializer's home), restoring the old `>= current` immunity there,
/// while out-of-space (ms-epoch) dirs above current are still reclaimed — the
/// two number spaces are separated by `OUT_OF_SPACE_SEQUENCE_FLOOR`.
#[test]
fn a_stale_materializer_cannot_reclaim_a_racing_newer_home() {
    let home = Home::new("stale-racer");

    // Sequence 41 is applied, then the fresh materializer writes sequence 42.
    apply(&home, 41);
    apply(&home, 42);
    let fresh_config =
        sequence_dir_path(home.path(), CODEX_HOME_PREFIX, 42).join(CODEX_CONFIG_FILE_NAME);
    assert!(fresh_config.exists(), "the fresh session's config exists");

    // The STALE materializer — a launch that read state.json before the 42
    // apply landed — finishes last and runs its GC with current = 41.
    apply(&home, 41);

    assert_eq!(
        home.codex_dirs(),
        vec!["codex-home-41".to_string(), "codex-home-42".to_string()],
        "a stale sweep must not reclaim the racing newer materializer's home"
    );
    assert!(
        fresh_config.exists(),
        "the fresh session's 0600 config.toml — the credential its env points \
         into — survives the stale sweep"
    );
}
