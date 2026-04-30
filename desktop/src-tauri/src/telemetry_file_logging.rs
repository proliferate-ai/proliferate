use std::fs;
use std::path::{Path, PathBuf};

use file_rotate::{compression::Compression, suffix::AppendCount, ContentLimit, FileRotate};
use tracing_appender::{
    non_blocking,
    non_blocking::{NonBlocking, WorkerGuard},
};

const MAX_LOG_BYTES: usize = 10 * 1024 * 1024;
const MAX_ROTATED_FILES: usize = 5;

#[derive(Debug)]
pub struct FileLogSink {
    pub writer: NonBlocking,
    pub guard: WorkerGuard,
    pub path: PathBuf,
}

fn build_rotating_writer(log_path: &Path) -> Result<FileRotate<AppendCount>, String> {
    let Some(parent) = log_path.parent() else {
        return Err(format!(
            "Log path {} has no parent directory",
            log_path.display()
        ));
    };

    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;

    Ok(FileRotate::new(
        log_path,
        AppendCount::new(MAX_ROTATED_FILES),
        ContentLimit::Bytes(MAX_LOG_BYTES),
        Compression::None,
        None,
    ))
}

pub fn create_file_log_sink(log_path: &Path) -> Result<FileLogSink, String> {
    let writer = build_rotating_writer(log_path)?;
    let (writer, guard) = non_blocking(writer);
    Ok(FileLogSink {
        writer,
        guard,
        path: log_path.to_path_buf(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path(file_name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("desktop-file-logging-{unique}"))
            .join(file_name)
    }

    #[test]
    fn rotating_writer_creates_file_on_first_write() {
        let path = temp_path("desktop-native.log");
        let mut writer = build_rotating_writer(&path).expect("writer should be created");
        writeln!(writer, "hello desktop").expect("write should succeed");
        writer.flush().expect("flush should succeed");

        let contents = fs::read_to_string(&path).expect("log file should exist");
        assert!(contents.contains("hello desktop"));

        fs::remove_dir_all(path.parent().expect("temp dir should exist"))
            .expect("cleanup should succeed");
    }

    #[test]
    fn rotating_writer_does_not_rotate_below_threshold() {
        let path = temp_path("desktop-native.log");
        let mut writer = build_rotating_writer(&path).expect("writer should be created");
        for _ in 0..100 {
            writeln!(writer, "short line").expect("write should succeed");
        }
        writer.flush().expect("flush should succeed");

        assert!(path.is_file());
        assert!(!path.with_extension("log.1").is_file());

        fs::remove_dir_all(path.parent().expect("temp dir should exist"))
            .expect("cleanup should succeed");
    }

    #[test]
    fn rotating_writer_rotates_above_threshold() {
        let path = temp_path("desktop-native.log");
        let mut writer = build_rotating_writer(&path).expect("writer should be created");
        let oversized = "x".repeat(MAX_LOG_BYTES + 1024);
        writer
            .write_all(oversized.as_bytes())
            .expect("large write should succeed");
        writer.flush().expect("flush should succeed");
        writer
            .write_all(b"next line")
            .expect("follow-up write should succeed");
        writer.flush().expect("flush should succeed");

        assert!(path.is_file());
        assert!(path.with_extension("log.1").is_file());

        fs::remove_dir_all(path.parent().expect("temp dir should exist"))
            .expect("cleanup should succeed");
    }

    #[test]
    fn rotating_writer_caps_retained_files() {
        let path = temp_path("desktop-native.log");
        let mut writer = build_rotating_writer(&path).expect("writer should be created");
        let oversized = "y".repeat(MAX_LOG_BYTES + 1024);

        for _ in 0..(MAX_ROTATED_FILES + 3) {
            writer
                .write_all(oversized.as_bytes())
                .expect("write should succeed");
            writer.flush().expect("flush should succeed");
        }

        assert!(path.with_extension("log.1").is_file());
        assert!(path.with_extension("log.5").is_file());
        assert!(!path.with_extension("log.6").is_file());

        fs::remove_dir_all(path.parent().expect("temp dir should exist"))
            .expect("cleanup should succeed");
    }

    #[test]
    fn create_file_log_sink_errors_when_parent_is_not_directory() {
        let parent = temp_path("blocked-parent");
        fs::create_dir_all(parent.parent().expect("temp dir should exist"))
            .expect("parent dir should exist");
        fs::write(&parent, "not a dir").expect("blocking file should be created");
        let log_path = parent.join("desktop-native.log");

        let error = create_file_log_sink(&log_path).expect_err("sink creation should fail");
        assert!(error.contains("Failed to create"));

        fs::remove_dir_all(parent.parent().expect("temp dir should exist"))
            .expect("cleanup should succeed");
    }
}
