use super::*;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

#[derive(Default)]
struct TestEditorRuntime {
    which_paths: HashMap<&'static str, PathBuf>,
    existing_files: HashSet<PathBuf>,
    spawns: RefCell<Vec<(PathBuf, String)>>,
}

impl EditorRuntime for TestEditorRuntime {
    fn which(&self, bin: &str) -> Option<PathBuf> {
        self.which_paths.get(bin).cloned()
    }

    fn is_file(&self, path: &Path) -> bool {
        self.existing_files.contains(path)
    }

    fn spawn_editor(&self, program: &Path, target_path: &str) -> Result<(), String> {
        self.spawns
            .borrow_mut()
            .push((program.to_path_buf(), target_path.to_string()));
        Ok(())
    }
}

#[test]
fn editor_registry_ids_are_unique() {
    let ids: HashSet<&'static str> = EDITOR_DEFINITIONS
        .iter()
        .map(|definition| definition.id)
        .collect();
    assert_eq!(ids.len(), EDITOR_DEFINITIONS.len());
}

#[test]
fn every_editor_definition_has_an_icon_id() {
    for definition in EDITOR_DEFINITIONS {
        match definition.icon_id {
            EditorIconId::Cursor
            | EditorIconId::Vscode
            | EditorIconId::Windsurf
            | EditorIconId::Zed
            | EditorIconId::Sublime => {}
        }
    }
}

#[test]
fn listing_includes_only_resolved_editors() {
    let runtime = TestEditorRuntime {
        which_paths: HashMap::from([
            ("cursor", PathBuf::from("/mock/bin/cursor")),
            ("zed", PathBuf::from("/mock/bin/zed")),
        ]),
        ..Default::default()
    };

    let editors = list_available_editors_with(&runtime);

    assert_eq!(
        editors,
        vec![
            EditorInfo {
                id: "cursor".to_string(),
                label: "Cursor".to_string(),
                shortcut: Some("\u{2318}O".to_string()),
                icon_id: EditorIconId::Cursor,
            },
            EditorInfo {
                id: "zed".to_string(),
                label: "Zed".to_string(),
                shortcut: None,
                icon_id: EditorIconId::Zed,
            },
        ]
    );
}

#[test]
fn path_resolution_wins_over_macos_bundle_fallback() {
    let runtime = TestEditorRuntime {
        which_paths: HashMap::from([("code", PathBuf::from("/mock/bin/code"))]),
        #[cfg(target_os = "macos")]
        existing_files: HashSet::from([PathBuf::from(
            "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
        )]),
        ..Default::default()
    };

    let resolved = resolve_installed_editor_with(&runtime, "code").expect("resolved editor");

    assert_eq!(resolved.1, PathBuf::from("/mock/bin/code"));
}

#[cfg(target_os = "macos")]
#[test]
fn macos_bundle_fallback_resolves_when_path_lookup_misses() {
    let bundle_path =
        PathBuf::from("/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf");
    let runtime = TestEditorRuntime {
        existing_files: HashSet::from([bundle_path.clone()]),
        ..Default::default()
    };

    let resolved = resolve_installed_editor_with(&runtime, "windsurf").expect("resolved editor");

    assert_eq!(resolved.1, bundle_path);
}

#[test]
fn unknown_editor_ids_return_a_clean_error() {
    let runtime = TestEditorRuntime::default();

    let error = resolve_installed_editor_with(&runtime, "unknown-editor")
        .expect_err("unknown editor should fail");

    assert_eq!(error, "Unknown editor: unknown-editor");
}

#[test]
fn opening_uses_the_same_resolver_path_as_listing() {
    let runtime = TestEditorRuntime {
        which_paths: HashMap::from([("cursor", PathBuf::from("/mock/bin/cursor"))]),
        ..Default::default()
    };

    let listed = list_available_editors_with(&runtime);
    open_path_in_editor_with(&runtime, "/tmp/project", "cursor").expect("open should succeed");

    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, "cursor");
    assert_eq!(
        runtime.spawns.into_inner(),
        vec![(
            PathBuf::from("/mock/bin/cursor"),
            "/tmp/project".to_string()
        )]
    );
}
