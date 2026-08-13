use serde::Serialize;

/// One top-level item from the most recent drag session, resolved to an
/// absolute filesystem path. `size` is `None` for directories.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DroppedPathEntry {
    pub path: String,
    pub name: String,
    pub is_directory: bool,
    pub size: Option<u64>,
}

/// Absolute paths for the items in the drag session that just dropped onto the
/// webview. HTML5 drops never expose filesystem paths, so the composer calls
/// this right after a DOM drop while the macOS drag pasteboard still holds the
/// dragged filenames — the same source wry reads for native drag-drop events.
/// Returns an empty list off macOS or when the drag carried no file paths
/// (e.g. content dragged out of another app rather than Finder).
///
/// The drag pasteboard carries no per-drop session token, so full correlation
/// with the DOM drop is impossible by construction; `changeCount` guards the
/// read against a new drag session replacing the pasteboard mid-snapshot, and
/// the renderer rejects results whose shape does not correspond to the
/// dropped FileList.
#[tauri::command]
pub fn read_drag_drop_paths() -> Vec<DroppedPathEntry> {
    drag_pasteboard_paths()
        .into_iter()
        .filter_map(entry_for_path)
        .collect()
}

fn entry_for_path(path: String) -> Option<DroppedPathEntry> {
    let metadata = std::fs::metadata(&path).ok()?;
    let name = std::path::Path::new(&path)
        .file_name()?
        .to_string_lossy()
        .into_owned();
    let is_directory = metadata.is_dir();
    Some(DroppedPathEntry {
        size: (!is_directory).then(|| metadata.len()),
        path,
        name,
        is_directory,
    })
}

#[cfg(target_os = "macos")]
fn drag_pasteboard_paths() -> Vec<String> {
    #[allow(deprecated)]
    use objc2_app_kit::{NSFilenamesPboardType, NSPasteboard, NSPasteboardNameDrag};
    use objc2_foundation::{NSArray, NSString};

    let mut paths = Vec::new();
    #[allow(deprecated)]
    unsafe {
        let pasteboard = NSPasteboard::pasteboardWithName(NSPasteboardNameDrag);
        let change_count = pasteboard.changeCount();
        let types = NSArray::arrayWithObject(NSFilenamesPboardType);
        if pasteboard.availableTypeFromArray(&types).is_none() {
            return paths;
        }
        let Some(list) = pasteboard.propertyListForType(NSFilenamesPboardType) else {
            return paths;
        };
        let Ok(list) = list.downcast::<NSArray>() else {
            return paths;
        };
        for item in list {
            if let Ok(item) = item.downcast::<NSString>() {
                paths.push(item.to_string());
            }
        }
        // A new drag session replaced the pasteboard while this snapshot was
        // being read; the paths no longer describe the drop being handled.
        if pasteboard.changeCount() != change_count {
            return Vec::new();
        }
    }
    paths
}

#[cfg(not(target_os = "macos"))]
fn drag_pasteboard_paths() -> Vec<String> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::entry_for_path;

    #[test]
    fn maps_files_with_size_and_directories_without() {
        let dir = std::env::temp_dir().join(format!("drag-drop-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let file = dir.join("archive.zip");
        std::fs::write(&file, b"zip-bytes").expect("write temp file");

        let file_entry =
            entry_for_path(file.to_string_lossy().into_owned()).expect("file entry");
        assert_eq!(file_entry.name, "archive.zip");
        assert!(!file_entry.is_directory);
        assert_eq!(file_entry.size, Some(9));

        let dir_entry = entry_for_path(dir.to_string_lossy().into_owned()).expect("dir entry");
        assert!(dir_entry.is_directory);
        assert_eq!(dir_entry.size, None);

        assert!(entry_for_path(dir.join("missing").to_string_lossy().into_owned()).is_none());
        std::fs::remove_dir_all(&dir).ok();
    }
}
