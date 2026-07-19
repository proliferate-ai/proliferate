use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use file_rotate::{compression::Compression, suffix::AppendCount, ContentLimit, FileRotate};
use tracing_appender::{
    non_blocking,
    non_blocking::{NonBlocking, WorkerGuard},
};

const MAX_LOG_BYTES: usize = 10 * 1024 * 1024;
const MAX_ROTATED_FILES: usize = 5;
pub const RENDERER_DIAGNOSTIC_TARGET: &str = "proliferate.renderer_diagnostic";

#[derive(Debug)]
pub struct FileLogSink {
    pub writer: NonBlocking,
    pub guard: WorkerGuard,
    pub path: PathBuf,
}

pub(crate) trait RendererDiagnosticWriter: Send {
    fn persist(&mut self, line: &str) -> io::Result<()>;
}

struct RotatingRendererDiagnosticWriter {
    path: PathBuf,
    file: Option<File>,
    bytes_written: usize,
    max_log_bytes: usize,
    max_rotated_files: usize,
}

impl RotatingRendererDiagnosticWriter {
    fn open(path: PathBuf, max_log_bytes: usize, max_rotated_files: usize) -> io::Result<Self> {
        let Some(parent) = path.parent() else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("Log path {} has no parent directory", path.display()),
            ));
        };
        fs::create_dir_all(parent)?;
        let file = open_append_file(&path)?;
        let bytes_written = file.metadata()?.len() as usize;
        Ok(Self {
            path,
            file: Some(file),
            bytes_written,
            max_log_bytes,
            max_rotated_files,
        })
    }

    fn ensure_open(&mut self) -> io::Result<()> {
        if self.file.is_none() {
            let file = open_append_file(&self.path)?;
            self.bytes_written = file.metadata()?.len() as usize;
            self.file = Some(file);
        }
        Ok(())
    }

    fn rotate(&mut self) -> io::Result<()> {
        if let Some(mut file) = self.file.take() {
            file.flush()?;
            file.sync_data()?;
        }
        rotate_renderer_diagnostic_files(&self.path, self.max_rotated_files)?;
        self.ensure_open()
    }
}

impl RendererDiagnosticWriter for RotatingRendererDiagnosticWriter {
    fn persist(&mut self, line: &str) -> io::Result<()> {
        self.ensure_open()?;
        let record_bytes = line.len().saturating_add(1);
        if self.bytes_written > 0
            && self.bytes_written.saturating_add(record_bytes) > self.max_log_bytes
        {
            self.rotate()?;
        }

        let file = self
            .file
            .as_mut()
            .ok_or_else(|| io::Error::other("renderer diagnostic file is unavailable"))?;
        file.write_all(line.as_bytes())?;
        file.write_all(b"\n")?;
        file.flush()?;
        file.sync_data()?;
        self.bytes_written = self.bytes_written.saturating_add(record_bytes);
        Ok(())
    }
}

type SharedRendererDiagnosticWriter = Arc<Mutex<Box<dyn RendererDiagnosticWriter>>>;

#[derive(Clone, Default)]
pub struct RendererDiagnosticLog {
    writer: Option<SharedRendererDiagnosticWriter>,
}

impl fmt::Debug for RendererDiagnosticLog {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RendererDiagnosticLog")
            .field("available", &self.writer.is_some())
            .finish()
    }
}

impl RendererDiagnosticLog {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        Self::open_with_limits(path, MAX_LOG_BYTES, MAX_ROTATED_FILES)
    }

    fn open_with_limits(
        path: PathBuf,
        max_log_bytes: usize,
        max_rotated_files: usize,
    ) -> Result<Self, String> {
        let display_path = path.display().to_string();
        let writer = RotatingRendererDiagnosticWriter::open(path, max_log_bytes, max_rotated_files)
            .map_err(|error| {
                format!("Failed to open renderer diagnostic log {display_path}: {error}")
            })?;
        Ok(Self {
            writer: Some(Arc::new(Mutex::new(Box::new(writer)))),
        })
    }

    #[cfg(test)]
    pub(crate) fn from_path(path: PathBuf) -> Result<Self, String> {
        Self::open(path)
    }

    #[cfg(test)]
    pub(crate) fn from_writer(writer: impl RendererDiagnosticWriter + 'static) -> Self {
        Self {
            writer: Some(Arc::new(Mutex::new(Box::new(writer)))),
        }
    }

    pub fn persist(&self, line: &str) -> Result<(), String> {
        let writer = self
            .writer
            .as_ref()
            .ok_or_else(|| "Renderer diagnostic file log sink is unavailable".to_string())?;
        let mut writer = writer
            .lock()
            .map_err(|_| "Renderer diagnostic log lock is poisoned".to_string())?;
        writer
            .persist(line)
            .map_err(|error| format!("Failed to persist renderer diagnostic: {error}"))
    }
}

fn open_append_file(path: &Path) -> io::Result<File> {
    OpenOptions::new().create(true).append(true).open(path)
}

fn rotated_renderer_path(path: &Path, index: usize) -> PathBuf {
    let mut rotated = path.as_os_str().to_os_string();
    rotated.push(format!(".{index}"));
    PathBuf::from(rotated)
}

fn rotate_renderer_diagnostic_files(path: &Path, max_rotated_files: usize) -> io::Result<()> {
    if max_rotated_files == 0 {
        if path.exists() {
            fs::remove_file(path)?;
        }
        return Ok(());
    }

    let oldest = rotated_renderer_path(path, max_rotated_files);
    if oldest.exists() {
        fs::remove_file(&oldest)?;
    }
    for index in (1..=max_rotated_files).rev() {
        let source = if index == 1 {
            path.to_path_buf()
        } else {
            rotated_renderer_path(path, index - 1)
        };
        if source.exists() {
            fs::rename(source, rotated_renderer_path(path, index))?;
        }
    }
    Ok(())
}

pub fn is_renderer_diagnostic_event(metadata: &tracing::Metadata<'_>) -> bool {
    metadata.target() == RENDERER_DIAGNOSTIC_TARGET
}

fn write_and_flush(writer: &mut impl Write, line: &str) -> std::io::Result<()> {
    writer.write_all(line.as_bytes())?;
    writer.write_all(b"\n")?;
    writer.flush()
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
    use std::io::{self, Write};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEMP_PATH_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    fn temp_path(file_name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        let sequence = TEMP_PATH_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir()
            .join(format!(
                "desktop-file-logging-{}-{unique}-{sequence}",
                std::process::id()
            ))
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

    #[test]
    fn renderer_diagnostic_log_errors_when_file_sink_is_unavailable() {
        let error = RendererDiagnosticLog::default()
            .persist("renderer diagnostic")
            .expect_err("unavailable sink must fail");

        assert!(error.contains("file log sink is unavailable"));
    }

    #[test]
    fn renderer_diagnostic_log_writes_flushes_and_syncs_before_success() {
        let path = temp_path("desktop-native.log");
        fs::create_dir_all(path.parent().expect("temp dir should exist"))
            .expect("parent should be created");
        RendererDiagnosticLog::from_path(path.clone())
            .expect("renderer diagnostic log should open")
            .persist("renderer diagnostic")
            .expect("durable persistence should succeed");

        assert_eq!(
            fs::read_to_string(&path).expect("diagnostic should be readable"),
            "renderer diagnostic\n"
        );
        fs::remove_dir_all(path.parent().expect("temp dir should exist"))
            .expect("cleanup should succeed");
    }

    struct FailingWriter {
        fail_flush: bool,
    }

    impl Write for FailingWriter {
        fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
            if self.fail_flush {
                Ok(buffer.len())
            } else {
                Err(io::Error::other("write failed"))
            }
        }

        fn flush(&mut self) -> io::Result<()> {
            if self.fail_flush {
                Err(io::Error::other("flush failed"))
            } else {
                Ok(())
            }
        }
    }

    #[test]
    fn renderer_diagnostic_write_and_flush_failures_are_observable() {
        let write_error = write_and_flush(
            &mut FailingWriter { fail_flush: false },
            "renderer diagnostic",
        )
        .expect_err("write failure must be returned");
        assert_eq!(write_error.to_string(), "write failed");

        let flush_error = write_and_flush(
            &mut FailingWriter { fail_flush: true },
            "renderer diagnostic",
        )
        .expect_err("flush failure must be returned");
        assert_eq!(flush_error.to_string(), "flush failed");
    }

    #[test]
    fn renderer_diagnostic_log_rotates_whole_records_and_caps_retention() {
        let path = temp_path("renderer-diagnostics.log");
        let log = RendererDiagnosticLog::open_with_limits(path.clone(), 12, 2)
            .expect("renderer diagnostic log should open");

        for line in ["first", "second", "third", "fourth"] {
            log.persist(line).expect("record should persist durably");
        }

        assert_eq!(
            fs::read_to_string(&path).expect("current log should exist"),
            "fourth\n"
        );
        assert_eq!(
            fs::read_to_string(rotated_renderer_path(&path, 1))
                .expect("first rotated log should exist"),
            "third\n"
        );
        assert_eq!(
            fs::read_to_string(rotated_renderer_path(&path, 2))
                .expect("second rotated log should exist"),
            "second\n"
        );
        assert!(!rotated_renderer_path(&path, 3).exists());

        fs::remove_dir_all(path.parent().expect("temp dir should exist"))
            .expect("cleanup should succeed");
    }

    #[test]
    fn renderer_diagnostic_log_serializes_concurrent_records() {
        let path = temp_path("renderer-diagnostics.log");
        let log = RendererDiagnosticLog::open_with_limits(path.clone(), usize::MAX, 1)
            .expect("renderer diagnostic log should open");
        let mut workers = Vec::new();

        for worker in 0..8 {
            let worker_log = log.clone();
            workers.push(std::thread::spawn(move || {
                for record in 0..20 {
                    worker_log
                        .persist(&format!(r#"{{"worker":{worker},"record":{record}}}"#))
                        .expect("concurrent record should persist");
                }
            }));
        }
        for worker in workers {
            worker.join().expect("worker should finish");
        }

        let contents = fs::read_to_string(&path).expect("diagnostic log should be readable");
        let records = contents
            .lines()
            .map(|line| serde_json::from_str::<serde_json::Value>(line).expect("whole JSON record"))
            .collect::<Vec<_>>();
        assert_eq!(records.len(), 160);

        fs::remove_dir_all(path.parent().expect("temp dir should exist"))
            .expect("cleanup should succeed");
    }
}
