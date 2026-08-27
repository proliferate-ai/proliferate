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
/// that revision. The sweep now keeps exactly current + immediately-previous and
/// reclaims everything else, in EITHER direction of the number space.
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
