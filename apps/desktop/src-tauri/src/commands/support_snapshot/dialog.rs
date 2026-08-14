use std::path::PathBuf;

use chrono::{SecondsFormat, Utc};
use rfd::FileDialog;

pub(super) fn choose_archive_path() -> Result<Option<(PathBuf, String)>, String> {
    let suggested = format!(
        "proliferate-support-snapshot-{}.zip",
        Utc::now()
            .to_rfc3339_opts(SecondsFormat::Secs, true)
            .replace(':', "-")
    );
    let Some(output_path) = FileDialog::new()
        .add_filter("Zip archive", &["zip"])
        .set_file_name(&suggested)
        .save_file()
    else {
        return Ok(None);
    };
    let archive_name = output_path
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
        .ok_or_else(|| "support_snapshot_archive_invalid_name".to_string())?;
    if !display_safe_archive_name(&archive_name) {
        return Err("support_snapshot_archive_invalid_name".to_string());
    }
    Ok(Some((output_path, archive_name)))
}

fn display_safe_archive_name(value: &str) -> bool {
    !value.is_empty()
        && !matches!(value, "." | "..")
        && value.len() <= 128
        && !value
            .chars()
            .any(|character| character.is_control() || matches!(character, '/' | '\\'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn archive_receipt_is_bounded_and_not_a_path() {
        assert!(display_safe_archive_name("snapshot.zip"));
        assert!(!display_safe_archive_name(""));
        assert!(!display_safe_archive_name("../snapshot.zip"));
        assert!(!display_safe_archive_name("bad\nname.zip"));
        assert!(!display_safe_archive_name(&format!(
            "{}.zip",
            "x".repeat(128)
        )));
    }
}
