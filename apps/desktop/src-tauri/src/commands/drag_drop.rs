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

/// The drag pasteboard's current change count. Each drag session writes the
/// pasteboard once, incrementing the count, so a count captured during a DOM
/// drag-enter identifies the session that later delivers the DOM drop. -1 off
/// macOS.
#[tauri::command]
pub fn drag_pasteboard_change_count() -> i64 {
    drag_pasteboard_change_count_impl()
}

/// Absolute paths for the items in the drag session that just dropped onto the
/// webview, plus the pasteboard change count the snapshot was read under.
/// HTML5 drops never expose filesystem paths, so the composer calls this right
/// after a DOM drop while the macOS drag pasteboard still holds the dragged
/// filenames — the same source wry reads for native drag-drop events. The
/// entries are empty off macOS or when the drag carried no file paths (e.g.
/// content dragged out of another app rather than Finder).
///
/// Correlation with the DOM drop: the renderer captures
/// `drag_pasteboard_change_count` when the drag enters the webview and rejects
/// this snapshot when the counts differ (another drag session replaced the
/// pasteboard). The read itself is also discarded when the count moves
/// mid-snapshot.
#[tauri::command]
pub fn read_drag_drop_paths() -> DroppedPathsSnapshot {
    let (change_count, paths) = drag_pasteboard_paths();
    DroppedPathsSnapshot {
        change_count,
        entries: paths.into_iter().filter_map(entry_for_path).collect(),
    }
}

/// A pasteboard snapshot: the change count it was read under and the resolved
/// entries.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DroppedPathsSnapshot {
    pub change_count: i64,
    pub entries: Vec<DroppedPathEntry>,
}

fn entry_for_path(path: String) -> Option<DroppedPathEntry> {
    let metadata = std::fs::metadata(&path).ok()?;
    let name = std::path::Path::new(&path)
        .file_name()?
        .to_string_lossy()
        .into_owned();
    let is_directory = metadata.is_dir();
    Some(DroppedPathEntry {
        size: (!is_directory).then_some(metadata.len()),
        path,
        name,
        is_directory,
    })
}

#[cfg(target_os = "macos")]
fn drag_pasteboard_change_count_impl() -> i64 {
    use objc2_app_kit::{NSPasteboard, NSPasteboardNameDrag};
    unsafe { NSPasteboard::pasteboardWithName(NSPasteboardNameDrag).changeCount() as i64 }
}

#[cfg(not(target_os = "macos"))]
fn drag_pasteboard_change_count_impl() -> i64 {
    -1
}

#[cfg(target_os = "macos")]
fn drag_pasteboard_paths() -> (i64, Vec<String>) {
    #[allow(deprecated)]
    use objc2_app_kit::{NSFilenamesPboardType, NSPasteboard, NSPasteboardNameDrag};
    use objc2_foundation::{NSArray, NSString};

    let mut paths = Vec::new();
    #[allow(deprecated)]
    unsafe {
        let pasteboard = NSPasteboard::pasteboardWithName(NSPasteboardNameDrag);
        let change_count = pasteboard.changeCount() as i64;
        let types = NSArray::arrayWithObject(NSFilenamesPboardType);
        if pasteboard.availableTypeFromArray(&types).is_none() {
            return (change_count, paths);
        }
        let Some(list) = pasteboard.propertyListForType(NSFilenamesPboardType) else {
            return (change_count, paths);
        };
        let Ok(list) = list.downcast::<NSArray>() else {
            return (change_count, paths);
        };
        for item in list {
            if let Ok(item) = item.downcast::<NSString>() {
                paths.push(item.to_string());
            }
        }
        // A new drag session replaced the pasteboard while this snapshot was
        // being read; the paths no longer describe the drop being handled.
        if pasteboard.changeCount() as i64 != change_count {
            return (change_count, Vec::new());
        }
        (change_count, paths)
    }
}

#[cfg(not(target_os = "macos"))]
fn drag_pasteboard_paths() -> (i64, Vec<String>) {
    (-1, Vec::new())
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

        let file_entry = entry_for_path(file.to_string_lossy().into_owned()).expect("file entry");
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
