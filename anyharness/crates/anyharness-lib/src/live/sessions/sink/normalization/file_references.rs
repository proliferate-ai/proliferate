use std::path::{Component, Path, PathBuf};

use super::super::state::{FileReadLineScope, NormalizedFileReference};
use anyharness_contract::v1::FileReadScope;

pub(in crate::live::sessions::sink) fn resolve_file_references(
    raw_input: Option<&serde_json::Value>,
    locations: Option<&Vec<serde_json::Value>>,
    preferred_path: Option<String>,
    workspace_root: &Path,
) -> (
    Option<NormalizedFileReference>,
    Option<NormalizedFileReference>,
) {
    let input_path = raw_input
        .and_then(|value| value.get("file_path"))
        .and_then(serde_json::Value::as_str)
        .map(String::from)
        .or_else(|| {
            raw_input
                .and_then(|value| value.get("path"))
                .and_then(serde_json::Value::as_str)
                .map(String::from)
        })
        .or_else(|| {
            raw_input
                .and_then(|value| value.get("parsed_cmd"))
                .and_then(serde_json::Value::as_array)
                .and_then(|items| {
                    items.iter().find_map(|item| {
                        item.get("path")
                            .and_then(serde_json::Value::as_str)
                            .map(String::from)
                    })
                })
        });
    let old_path = raw_input
        .and_then(|value| value.get("old_path"))
        .and_then(serde_json::Value::as_str)
        .map(String::from);
    let new_path = raw_input
        .and_then(|value| value.get("new_path"))
        .and_then(serde_json::Value::as_str)
        .map(String::from);
    let location_path = locations.and_then(|items| {
        items.iter().find_map(|item| {
            item.get("path")
                .and_then(serde_json::Value::as_str)
                .map(String::from)
        })
    });
    let location_line = extract_location_line(locations);

    let path = old_path
        .clone()
        .or(input_path)
        .or(preferred_path)
        .or(location_path)
        .or_else(|| new_path.clone());

    let normalized_new_path = match (&old_path, &new_path) {
        (Some(old), Some(new)) if old != new => Some(new.clone()),
        _ => None,
    };

    (
        path.and_then(|entry| normalize_file_reference(&entry, workspace_root, location_line)),
        normalized_new_path
            .and_then(|entry| normalize_file_reference(&entry, workspace_root, location_line)),
    )
}

pub(in crate::live::sessions::sink) fn determine_file_read_scope(
    raw_input: Option<&serde_json::Value>,
    locations: Option<&Vec<serde_json::Value>>,
) -> FileReadLineScope {
    let start_line = extract_i64_keys(
        raw_input,
        &[
            "start_line",
            "startLine",
            "line_start",
            "lineStart",
            "from_line",
            "fromLine",
        ],
    );
    let end_line = extract_i64_keys(
        raw_input,
        &[
            "end_line", "endLine", "line_end", "lineEnd", "to_line", "toLine",
        ],
    );

    if let Some(start) = start_line {
        let end = end_line.unwrap_or(start);
        if start == end {
            return FileReadLineScope {
                scope: FileReadScope::Line,
                line: Some(start),
                start_line: Some(start),
                end_line: Some(end),
            };
        }
        return FileReadLineScope {
            scope: FileReadScope::Range,
            line: None,
            start_line: Some(start),
            end_line: Some(end),
        };
    }

    let line = extract_i64_keys(raw_input, &["line", "lineNumber", "line_number"]);

    if let Some(line) = line {
        return FileReadLineScope {
            scope: FileReadScope::Line,
            line: Some(line),
            start_line: Some(line),
            end_line: Some(line),
        };
    }

    FileReadLineScope {
        scope: if raw_input.is_some() || locations.is_some() {
            FileReadScope::Full
        } else {
            FileReadScope::Unknown
        },
        line: None,
        start_line: None,
        end_line: None,
    }
}

pub(in crate::live::sessions::sink) fn extract_location_line(
    locations: Option<&Vec<serde_json::Value>>,
) -> Option<i64> {
    locations.and_then(|items| {
        items
            .iter()
            .find_map(|item| item.get("line").and_then(read_i64_value))
    })
}

fn extract_i64_keys(value: Option<&serde_json::Value>, keys: &[&str]) -> Option<i64> {
    let value = value?;
    keys.iter()
        .find_map(|key| value.get(*key))
        .and_then(read_i64_value)
}

fn read_i64_value(value: &serde_json::Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|raw| i64::try_from(raw).ok()))
        .or_else(|| value.as_str().and_then(|raw| raw.parse::<i64>().ok()))
}

pub(in crate::live::sessions::sink) fn normalize_file_reference(
    raw_path: &str,
    workspace_root: &Path,
    line: Option<i64>,
) -> Option<NormalizedFileReference> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return None;
    }

    let workspace_path = normalize_workspace_path(trimmed, workspace_root);
    Some(NormalizedFileReference {
        raw_path: trimmed.to_string(),
        basename: path_basename(workspace_path.as_deref().unwrap_or(trimmed)),
        workspace_path,
        line,
    })
}

fn normalize_workspace_path(raw_path: &str, workspace_root: &Path) -> Option<String> {
    let path = Path::new(raw_path);
    if path.is_absolute() {
        let normalized_root = lexical_normalize_absolute(workspace_root)?;
        let normalized_path = lexical_normalize_absolute(path)?;
        let relative = normalized_path.strip_prefix(&normalized_root).ok()?;
        return Some(path_to_string(relative));
    }

    lexical_normalize_relative(path).map(|relative| path_to_string(relative.as_path()))
}

fn lexical_normalize_absolute(path: &Path) -> Option<PathBuf> {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::Normal(segment) => normalized.push(segment),
            Component::ParentDir => {
                if !normalized.pop() {
                    return None;
                }
            }
        }
    }

    Some(normalized)
}

fn lexical_normalize_relative(path: &Path) -> Option<PathBuf> {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(segment) => normalized.push(segment),
            Component::ParentDir => {
                if !normalized.pop() {
                    return None;
                }
            }
            Component::RootDir | Component::Prefix(_) => return None,
        }
    }

    Some(normalized)
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn path_basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|entry| entry.to_string_lossy().to_string())
        .filter(|entry| !entry.is_empty())
        .unwrap_or_else(|| path.to_string())
}
