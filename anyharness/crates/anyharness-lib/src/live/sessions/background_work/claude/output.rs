use std::path::{Path, PathBuf};

use tokio::io::{AsyncReadExt, AsyncSeekExt};

use super::BACKGROUND_WORK_FALLBACK_RESULT;

#[derive(Debug)]
pub(super) struct FileObservation {
    pub(super) activity_at: Option<chrono::DateTime<chrono::Utc>>,
    pub(super) result_text: Option<String>,
}

pub(super) async fn resolve_output_path(output_file: &str) -> PathBuf {
    let original_path = PathBuf::from(output_file);
    match tokio::fs::canonicalize(&original_path).await {
        Ok(path) => path,
        Err(_) => original_path,
    }
}

pub(super) async fn inspect_output_file(
    output_path: &Path,
    cursor: &mut u64,
    remainder: &mut Vec<u8>,
) -> anyhow::Result<FileObservation> {
    let metadata = tokio::fs::metadata(output_path).await?;
    if metadata.len() < *cursor {
        *cursor = 0;
        remainder.clear();
    }

    let activity_at = metadata
        .modified()
        .ok()
        .map(chrono::DateTime::<chrono::Utc>::from);
    if metadata.len() == *cursor {
        return Ok(FileObservation {
            activity_at: None,
            result_text: None,
        });
    }

    let mut file = tokio::fs::File::open(output_path).await?;
    file.seek(std::io::SeekFrom::Start(*cursor)).await?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).await?;
    *cursor += bytes.len() as u64;

    let mut chunk = std::mem::take(remainder);
    chunk.extend(bytes);

    let (complete_bytes, trailing_remainder) = match chunk.iter().rposition(|byte| *byte == b'\n') {
        Some(index) => (&chunk[..=index], &chunk[index + 1..]),
        None => {
            *remainder = chunk;
            return Ok(FileObservation {
                activity_at,
                result_text: None,
            });
        }
    };
    *remainder = trailing_remainder.to_vec();
    let complete_text = std::str::from_utf8(complete_bytes)?;

    let mut result_text = None;
    for line in complete_text.lines().filter(|line| !line.trim().is_empty()) {
        let Some(next_result_text) = extract_terminal_result_text(line) else {
            continue;
        };
        result_text = Some(next_result_text);
    }

    Ok(FileObservation {
        activity_at,
        result_text,
    })
}

pub(super) fn extract_terminal_result_text(line: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    if value.get("type").and_then(serde_json::Value::as_str) != Some("assistant") {
        return None;
    }

    let message = value.get("message")?;
    let stop_reason = message.get("stop_reason")?.as_str()?;
    if !is_terminal_stop_reason(stop_reason) {
        return None;
    }

    let text = message
        .get("content")
        .and_then(serde_json::Value::as_array)
        .map(|parts| {
            parts
                .iter()
                .filter(|part| part.get("type").and_then(serde_json::Value::as_str) == Some("text"))
                .filter_map(|part| part.get("text").and_then(serde_json::Value::as_str))
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
                .join("\n\n")
        })
        .unwrap_or_default();

    if text.trim().is_empty() {
        return Some(BACKGROUND_WORK_FALLBACK_RESULT.to_string());
    }

    Some(text)
}

fn is_terminal_stop_reason(stop_reason: &str) -> bool {
    matches!(stop_reason, "end_turn" | "stop_sequence" | "max_tokens")
}

pub(super) fn parse_timestamp(value: &str) -> chrono::DateTime<chrono::Utc> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|ts| ts.with_timezone(&chrono::Utc))
        .unwrap_or_else(|_| chrono::Utc::now())
}
