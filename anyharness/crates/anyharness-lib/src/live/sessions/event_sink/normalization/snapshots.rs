use std::path::Path;

use super::super::state::{AcpToolPayload, ParsedMeta};
use super::files::normalize_file_parts;
use super::text::normalize_text_parts;
use anyharness_contract::v1::{ContentPart, FileOpenTarget};

pub(in crate::live::sessions::event_sink) fn merge_snapshot_detail_parts(
    previous: Vec<ContentPart>,
    next: Vec<ContentPart>,
) -> Vec<ContentPart> {
    if next.is_empty() {
        return previous;
    }

    let mut previous_file_changes = previous
        .into_iter()
        .filter(|part| matches!(part, ContentPart::FileChange { .. }))
        .collect::<Vec<_>>();
    let mut merged = Vec::with_capacity(next.len() + previous_file_changes.len());

    for next_part in next {
        let Some(identity) = file_change_identity(&next_part) else {
            merged.push(next_part);
            continue;
        };

        let Some(index) = previous_file_changes
            .iter()
            .position(|part| file_change_identity(part).as_ref() == Some(&identity))
        else {
            merged.push(next_part);
            continue;
        };

        let previous_part = previous_file_changes.remove(index);
        merged.push(merge_file_change_part(previous_part, next_part));
    }

    merged.extend(previous_file_changes);
    merged
}

fn file_change_identity(part: &ContentPart) -> Option<(String, String)> {
    let ContentPart::FileChange {
        path,
        workspace_path,
        new_path,
        new_workspace_path,
        ..
    } = part
    else {
        return None;
    };

    Some((
        workspace_path.clone().unwrap_or_else(|| path.clone()),
        new_workspace_path
            .clone()
            .or_else(|| new_path.clone())
            .unwrap_or_default(),
    ))
}

fn merge_file_change_part(previous: ContentPart, next: ContentPart) -> ContentPart {
    let ContentPart::FileChange {
        operation: previous_operation,
        path: previous_path,
        workspace_path: previous_workspace_path,
        basename: previous_basename,
        new_path: previous_new_path,
        new_workspace_path: previous_new_workspace_path,
        new_basename: previous_new_basename,
        open_target: previous_open_target,
        additions: previous_additions,
        deletions: previous_deletions,
        patch: previous_patch,
        patch_truncated: previous_patch_truncated,
        patch_original_bytes: previous_patch_original_bytes,
        preview: previous_preview,
        preview_truncated: previous_preview_truncated,
        preview_original_bytes: previous_preview_original_bytes,
        native_tool_name: previous_native_tool_name,
    } = previous
    else {
        return next;
    };

    let ContentPart::FileChange {
        operation,
        path,
        workspace_path,
        basename,
        new_path,
        new_workspace_path,
        new_basename,
        open_target,
        additions,
        deletions,
        patch,
        patch_truncated,
        patch_original_bytes,
        preview,
        preview_truncated,
        preview_original_bytes,
        native_tool_name,
    } = next
    else {
        return ContentPart::FileChange {
            operation: previous_operation,
            path: previous_path,
            workspace_path: previous_workspace_path,
            basename: previous_basename,
            new_path: previous_new_path,
            new_workspace_path: previous_new_workspace_path,
            new_basename: previous_new_basename,
            open_target: previous_open_target,
            additions: previous_additions,
            deletions: previous_deletions,
            patch: previous_patch,
            patch_truncated: previous_patch_truncated,
            patch_original_bytes: previous_patch_original_bytes,
            preview: previous_preview,
            preview_truncated: previous_preview_truncated,
            preview_original_bytes: previous_preview_original_bytes,
            native_tool_name: previous_native_tool_name,
        };
    };

    let merged_patch = patch.or(previous_patch);
    let merged_open_target = if merged_patch.is_some() {
        Some(FileOpenTarget::Diff)
    } else if matches!(open_target, Some(FileOpenTarget::Diff))
        || matches!(previous_open_target, Some(FileOpenTarget::Diff))
    {
        Some(FileOpenTarget::Diff)
    } else {
        open_target.or(previous_open_target)
    };

    ContentPart::FileChange {
        operation,
        path: choose_string(path, previous_path),
        workspace_path: choose_option_string(workspace_path, previous_workspace_path),
        basename: choose_option_string(basename, previous_basename),
        new_path: choose_option_string(new_path, previous_new_path),
        new_workspace_path: choose_option_string(new_workspace_path, previous_new_workspace_path),
        new_basename: choose_option_string(new_basename, previous_new_basename),
        open_target: merged_open_target,
        additions: additions.or(previous_additions),
        deletions: deletions.or(previous_deletions),
        patch: merged_patch,
        patch_truncated: patch_truncated.or(previous_patch_truncated),
        patch_original_bytes: patch_original_bytes.or(previous_patch_original_bytes),
        preview: choose_option_string(preview, previous_preview),
        preview_truncated: preview_truncated.or(previous_preview_truncated),
        preview_original_bytes: preview_original_bytes.or(previous_preview_original_bytes),
        native_tool_name: choose_option_string(native_tool_name, previous_native_tool_name),
    }
}

fn choose_string(next: String, previous: String) -> String {
    if next.trim().is_empty() {
        previous
    } else {
        next
    }
}

fn choose_option_string(next: Option<String>, previous: Option<String>) -> Option<String> {
    next.filter(|value| !value.trim().is_empty()).or(previous)
}

pub(in crate::live::sessions::event_sink) fn normalize_snapshot_parts(
    payload: &AcpToolPayload,
    tool_kind: Option<&str>,
    native_tool_name: Option<String>,
    workspace_root: &Path,
    raw_input: Option<&serde_json::Value>,
    raw_output: Option<&serde_json::Value>,
    meta: &ParsedMeta,
) -> Vec<ContentPart> {
    let mut parts = normalize_file_parts(
        payload,
        tool_kind,
        native_tool_name.clone(),
        workspace_root,
        raw_input,
        raw_output,
    );
    if !parts.is_empty() {
        return parts;
    }

    parts.extend(normalize_text_parts(
        payload,
        tool_kind,
        native_tool_name.as_deref(),
        raw_input,
        raw_output,
        meta,
    ));

    parts
}
