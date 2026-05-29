use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(test)]
mod tests;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EditorIconId {
    Cursor,
    Vscode,
    Windsurf,
    Zed,
    Sublime,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorInfo {
    pub id: String,
    pub label: String,
    pub shortcut: Option<String>,
    pub icon_id: EditorIconId,
}

#[derive(Debug, Clone, Copy)]
struct EditorDefinition {
    id: &'static str,
    label: &'static str,
    shortcut: Option<&'static str>,
    icon_id: EditorIconId,
    bin: &'static str,
    #[cfg(target_os = "macos")]
    macos_bundle_bins: &'static [&'static str],
}

const EDITOR_DEFINITIONS: &[EditorDefinition] = &[
    EditorDefinition {
        id: "cursor",
        label: "Cursor",
        shortcut: Some("\u{2318}O"),
        icon_id: EditorIconId::Cursor,
        bin: "cursor",
        #[cfg(target_os = "macos")]
        macos_bundle_bins: &["/Applications/Cursor.app/Contents/Resources/app/bin/cursor"],
    },
    EditorDefinition {
        id: "code",
        label: "VS Code",
        shortcut: None,
        icon_id: EditorIconId::Vscode,
        bin: "code",
        #[cfg(target_os = "macos")]
        macos_bundle_bins: &["/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"],
    },
    EditorDefinition {
        id: "code-insiders",
        label: "VS Code Insiders",
        shortcut: None,
        icon_id: EditorIconId::Vscode,
        bin: "code-insiders",
        #[cfg(target_os = "macos")]
        macos_bundle_bins: &[
            "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders",
        ],
    },
    EditorDefinition {
        id: "codium",
        label: "VSCodium",
        shortcut: None,
        icon_id: EditorIconId::Vscode,
        bin: "codium",
        #[cfg(target_os = "macos")]
        macos_bundle_bins: &["/Applications/VSCodium.app/Contents/Resources/app/bin/codium"],
    },
    EditorDefinition {
        id: "windsurf",
        label: "Windsurf",
        shortcut: None,
        icon_id: EditorIconId::Windsurf,
        bin: "windsurf",
        #[cfg(target_os = "macos")]
        macos_bundle_bins: &["/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf"],
    },
    EditorDefinition {
        id: "zed",
        label: "Zed",
        shortcut: None,
        icon_id: EditorIconId::Zed,
        bin: "zed",
        #[cfg(target_os = "macos")]
        macos_bundle_bins: &["/Applications/Zed.app/Contents/MacOS/cli"],
    },
    EditorDefinition {
        id: "subl",
        label: "Sublime Text",
        shortcut: None,
        icon_id: EditorIconId::Sublime,
        bin: "subl",
        #[cfg(target_os = "macos")]
        macos_bundle_bins: &["/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl"],
    },
];

trait EditorRuntime {
    fn which(&self, bin: &str) -> Option<PathBuf>;
    fn is_file(&self, path: &Path) -> bool;
    fn spawn_editor(&self, program: &Path, target_path: &str) -> Result<(), String>;
}

struct SystemEditorRuntime;

impl EditorRuntime for SystemEditorRuntime {
    fn which(&self, bin: &str) -> Option<PathBuf> {
        which::which(bin).ok()
    }

    fn is_file(&self, path: &Path) -> bool {
        path.is_file()
    }

    fn spawn_editor(&self, program: &Path, target_path: &str) -> Result<(), String> {
        Command::new(program)
            .arg(target_path)
            .spawn()
            .map_err(|error| format!("Failed to open {}: {error}", program.display()))?;
        Ok(())
    }
}

fn definition_to_editor_info(definition: &EditorDefinition) -> EditorInfo {
    EditorInfo {
        id: definition.id.to_string(),
        label: definition.label.to_string(),
        shortcut: definition.shortcut.map(String::from),
        icon_id: definition.icon_id,
    }
}

fn find_editor_definition(id: &str) -> Option<&'static EditorDefinition> {
    EDITOR_DEFINITIONS
        .iter()
        .find(|definition| definition.id == id)
}

fn resolve_editor_bin_with(
    runtime: &impl EditorRuntime,
    definition: &EditorDefinition,
) -> Option<PathBuf> {
    if let Some(path) = runtime.which(definition.bin) {
        eprintln!(
            "[editors] found {} on PATH: {}",
            definition.id,
            path.display()
        );
        return Some(path);
    }

    #[cfg(target_os = "macos")]
    for bundle_path in definition.macos_bundle_bins {
        let path = PathBuf::from(bundle_path);
        if runtime.is_file(&path) {
            eprintln!(
                "[editors] found {} in app bundle: {}",
                definition.id,
                path.display()
            );
            return Some(path);
        }
    }

    eprintln!(
        "[editors] {} not found (checked PATH and app bundles)",
        definition.id
    );
    None
}

fn resolve_installed_editor_with(
    runtime: &impl EditorRuntime,
    editor_id: &str,
) -> Result<(&'static EditorDefinition, PathBuf), String> {
    let definition =
        find_editor_definition(editor_id).ok_or_else(|| format!("Unknown editor: {editor_id}"))?;

    let path = resolve_editor_bin_with(runtime, definition)
        .ok_or_else(|| format!("Unknown editor: {editor_id}"))?;

    Ok((definition, path))
}

fn list_available_editors_with(runtime: &impl EditorRuntime) -> Vec<EditorInfo> {
    let editors: Vec<EditorInfo> = EDITOR_DEFINITIONS
        .iter()
        .filter(|definition| resolve_editor_bin_with(runtime, definition).is_some())
        .map(definition_to_editor_info)
        .collect();

    eprintln!(
        "[editors] available editors: {:?}",
        editors.iter().map(|editor| &editor.id).collect::<Vec<_>>()
    );

    editors
}

fn open_path_in_editor_with(
    runtime: &impl EditorRuntime,
    path: &str,
    editor_id: &str,
) -> Result<(), String> {
    let (_, resolved_path) = resolve_installed_editor_with(runtime, editor_id)?;
    runtime.spawn_editor(&resolved_path, path)
}

pub fn list_available_editors() -> Vec<EditorInfo> {
    list_available_editors_with(&SystemEditorRuntime)
}

pub fn open_path_in_editor(path: &str, editor_id: &str) -> Result<(), String> {
    open_path_in_editor_with(&SystemEditorRuntime, path, editor_id)
}
