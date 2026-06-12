use std::path::Path;

use super::super::state::{AcpToolPayload, NormalizedFileReference};
use super::file_references::{
    determine_file_read_scope, extract_location_line, normalize_file_reference,
    resolve_file_references,
};
use super::synthesized_patch::{extract_diff_start_line, synthesize_patch};
use super::text::{count_lines, extract_preview};
use anyharness_contract::v1::{ContentPart, FileChangeOperation, FileOpenTarget};

pub(in crate::live::sessions::sink) fn normalize_file_parts(
    payload: &AcpToolPayload,
    tool_kind: Option<&str>,
    native_tool_name: Option<String>,
    workspace_root: &Path,
    raw_input: Option<&serde_json::Value>,
    raw_output: Option<&serde_json::Value>,
) -> Vec<ContentPart> {
    let mut parts = Vec::new();
    let locations = payload.locations.as_ref();

    if let Some(content) = &payload.content {
        for item in content {
            if item.get("type").and_then(serde_json::Value::as_str) != Some("diff") {
                continue;
            }

            let diff_path = item
                .get("path")
                .and_then(serde_json::Value::as_str)
                .map(String::from);
            let old_text = item
                .get("oldText")
                .and_then(serde_json::Value::as_str)
                .map(String::from);
            let new_text = item
                .get("newText")
                .and_then(serde_json::Value::as_str)
                .map(String::from);
            let raw_patch = item
                .get("patch")
                .and_then(serde_json::Value::as_str)
                .map(String::from);
            let synthesized_patch = if raw_patch.is_none() {
                let start_line = extract_diff_start_line(item, raw_input, locations);
                synthesize_patch(
                    diff_path.as_deref(),
                    old_text.as_deref(),
                    new_text.as_deref(),
                    start_line,
                )
            } else {
                None
            };
            let patch = raw_patch.or_else(|| {
                synthesized_patch
                    .as_ref()
                    .map(|synthesized| synthesized.patch.clone())
            });
            let additions = synthesized_patch
                .as_ref()
                .map(|patch| patch.additions)
                .or_else(|| item.get("additions").and_then(serde_json::Value::as_i64))
                .or_else(|| new_text.as_ref().map(|text| count_lines(text)));
            let deletions = synthesized_patch
                .as_ref()
                .map(|patch| patch.deletions)
                .or_else(|| item.get("deletions").and_then(serde_json::Value::as_i64))
                .or_else(|| old_text.as_ref().map(|text| count_lines(text)));

            let (path, new_path) =
                resolve_file_references(raw_input, locations, diff_path.clone(), workspace_root);
            let operation = determine_file_operation(
                native_tool_name.as_deref(),
                tool_kind,
                raw_input,
                old_text.as_deref(),
                new_text.as_deref(),
                path.as_ref().map(|entry| entry.raw_path.as_str()),
                new_path.as_ref().map(|entry| entry.raw_path.as_str()),
            );
            let path = path.or_else(|| {
                diff_path.as_deref().and_then(|entry| {
                    normalize_file_reference(
                        entry,
                        workspace_root,
                        extract_location_line(locations),
                    )
                })
            });

            parts.push(ContentPart::FileChange {
                operation,
                path: path
                    .as_ref()
                    .map(|entry| entry.raw_path.clone())
                    .or(diff_path)
                    .unwrap_or_else(|| payload.title.clone().unwrap_or_else(|| "file".to_string())),
                workspace_path: path.as_ref().and_then(|entry| entry.workspace_path.clone()),
                basename: path.as_ref().map(|entry| entry.basename.clone()),
                new_path: new_path.as_ref().map(|entry| entry.raw_path.clone()),
                new_workspace_path: new_path
                    .as_ref()
                    .and_then(|entry| entry.workspace_path.clone()),
                new_basename: new_path.as_ref().map(|entry| entry.basename.clone()),
                open_target: Some(
                    if patch.is_some() || old_text.is_some() || new_text.is_some() {
                        FileOpenTarget::Diff
                    } else {
                        FileOpenTarget::File
                    },
                ),
                additions,
                deletions,
                patch,
                patch_truncated: None,
                patch_original_bytes: None,
                preview: new_text,
                preview_truncated: None,
                preview_original_bytes: None,
                native_tool_name: native_tool_name.clone(),
            });
        }
    }

    if !parts.is_empty() {
        return parts;
    }

    let (path, new_path) = resolve_file_references(raw_input, locations, None, workspace_root);
    if is_file_read(tool_kind, native_tool_name.as_deref()) {
        if let Some(path) = path {
            let line_scope = determine_file_read_scope(raw_input, locations);
            let NormalizedFileReference {
                raw_path,
                workspace_path,
                basename,
                line,
            } = path;
            return vec![ContentPart::FileRead {
                path: raw_path,
                workspace_path,
                basename: Some(basename),
                line: line_scope.line.or(line),
                scope: Some(line_scope.scope),
                start_line: line_scope.start_line,
                end_line: line_scope.end_line,
                preview: extract_preview(raw_output),
                preview_truncated: None,
                preview_original_bytes: None,
            }];
        }
        return vec![];
    }

    if let Some(operation) = determine_operation_without_diff(
        native_tool_name.as_deref(),
        tool_kind,
        raw_input,
        path.as_ref().map(|entry| entry.raw_path.as_str()),
        new_path.as_ref().map(|entry| entry.raw_path.as_str()),
    ) {
        if let Some(path) = path.clone().or(new_path.clone()) {
            return vec![ContentPart::FileChange {
                operation,
                path: path.raw_path,
                workspace_path: path.workspace_path,
                basename: Some(path.basename),
                new_path: new_path.as_ref().map(|entry| entry.raw_path.clone()),
                new_workspace_path: new_path
                    .as_ref()
                    .and_then(|entry| entry.workspace_path.clone()),
                new_basename: new_path.as_ref().map(|entry| entry.basename.clone()),
                open_target: Some(FileOpenTarget::File),
                additions: None,
                deletions: None,
                patch: None,
                patch_truncated: None,
                patch_original_bytes: None,
                preview: extract_preview(raw_input).or_else(|| extract_preview(raw_output)),
                preview_truncated: None,
                preview_original_bytes: None,
                native_tool_name,
            }];
        }
    }

    Vec::new()
}

fn is_file_read(tool_kind: Option<&str>, native_tool_name: Option<&str>) -> bool {
    native_tool_name == Some("Read") || tool_kind == Some("read")
}

fn determine_operation_without_diff(
    native_tool_name: Option<&str>,
    tool_kind: Option<&str>,
    raw_input: Option<&serde_json::Value>,
    path: Option<&str>,
    new_path: Option<&str>,
) -> Option<FileChangeOperation> {
    match native_tool_name {
        Some("Write") => return Some(FileChangeOperation::Create),
        Some("Edit") => return Some(FileChangeOperation::Edit),
        Some("Delete") => return Some(FileChangeOperation::Delete),
        Some("Move") | Some("Rename") => return Some(FileChangeOperation::Move),
        _ => {}
    }

    match tool_kind {
        Some("delete") => Some(FileChangeOperation::Delete),
        Some("move") => Some(FileChangeOperation::Move),
        Some("edit") => {
            if path.is_some() && new_path.is_some() && path != new_path {
                Some(FileChangeOperation::Move)
            } else {
                Some(FileChangeOperation::Edit)
            }
        }
        _ => {
            let old_path = raw_input
                .and_then(|value| value.get("old_path"))
                .and_then(serde_json::Value::as_str);
            let next_path = raw_input
                .and_then(|value| value.get("new_path"))
                .and_then(serde_json::Value::as_str);
            if old_path.is_some() && next_path.is_some() && old_path != next_path {
                Some(FileChangeOperation::Move)
            } else {
                None
            }
        }
    }
}

fn determine_file_operation(
    native_tool_name: Option<&str>,
    tool_kind: Option<&str>,
    raw_input: Option<&serde_json::Value>,
    old_text: Option<&str>,
    new_text: Option<&str>,
    path: Option<&str>,
    new_path: Option<&str>,
) -> FileChangeOperation {
    if let Some(operation) =
        determine_operation_without_diff(native_tool_name, tool_kind, raw_input, path, new_path)
    {
        return operation;
    }

    match (old_text, new_text) {
        (None, Some(_)) => FileChangeOperation::Create,
        (Some(_), Some("")) => FileChangeOperation::Delete,
        (Some(old), Some(new)) if old.is_empty() && !new.is_empty() => FileChangeOperation::Create,
        (Some(old), Some(new)) if !old.is_empty() && new.is_empty() => FileChangeOperation::Delete,
        _ => FileChangeOperation::Edit,
    }
}
