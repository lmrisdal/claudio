use log::{LevelFilter, Log, Metadata, Record};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub const MAX_LOG_BYTES: u64 = 10 * 1024 * 1024;

struct LogFile {
    file: File,
    size: u64,
}

pub struct FileLogger {
    path: PathBuf,
    rotated_path: PathBuf,
    max_bytes: u64,
    level: LevelFilter,
    mirror_to_stderr: bool,
    file: Mutex<Option<LogFile>>,
}

impl FileLogger {
    pub fn new(dir: &Path, level: LevelFilter, max_bytes: u64, mirror_to_stderr: bool) -> Self {
        let path = dir.join("claudio.log");
        let rotated_path = dir.join("claudio.old.log");
        let file = open_log_file(&path);
        Self {
            path,
            rotated_path,
            max_bytes,
            level,
            mirror_to_stderr,
            file: Mutex::new(file),
        }
    }

    fn append(&self, line: &str) {
        let Ok(mut guard) = self.file.lock() else {
            return;
        };
        let incoming = line.len() as u64;
        if let Some(current) = guard.as_ref()
            && current.size > 0
            && current.size + incoming > self.max_bytes
        {
            *guard = None;
            let _ = fs::rename(&self.path, &self.rotated_path);
            *guard = open_log_file(&self.path);
        }
        if let Some(current) = guard.as_mut()
            && current.file.write_all(line.as_bytes()).is_ok()
        {
            current.size += incoming;
        }
    }
}

fn open_log_file(path: &Path) -> Option<LogFile> {
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .ok()?;
    let size = file.metadata().map(|meta| meta.len()).unwrap_or(0);
    Some(LogFile { file, size })
}

impl Log for FileLogger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        metadata.level() <= self.level
    }

    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let line = format!(
            "[{}][{}][{}] {}\n",
            format_timestamp(SystemTime::now()),
            record.level(),
            record.target(),
            record.args()
        );
        self.append(&line);
        if self.mirror_to_stderr {
            let _ = std::io::stderr().write_all(line.as_bytes());
        }
    }

    fn flush(&self) {
        if let Ok(mut guard) = self.file.lock()
            && let Some(current) = guard.as_mut()
        {
            let _ = current.file.flush();
        }
    }
}

pub fn init(dir: &Path, level: LevelFilter) {
    let logger = FileLogger::new(dir, level, MAX_LOG_BYTES, true);
    if log::set_logger(Box::leak(Box::new(logger))).is_ok() {
        log::set_max_level(level);
    }
}

pub(crate) fn format_timestamp(time: SystemTime) -> String {
    let seconds = time
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let (year, month, day) = civil_from_days((seconds / 86_400) as i64);
    let remainder = seconds % 86_400;
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        remainder / 3600,
        remainder % 3600 / 60,
        remainder % 60
    )
}

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_index + 2) / 5 + 1) as u32;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    } as u32;
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "claudio-logging-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = fs::create_dir_all(&dir);
        dir
    }

    fn write_record(logger: &FileLogger, level: log::Level, message: &str) {
        logger.log(
            &Record::builder()
                .level(level)
                .target("test")
                .args(format_args!("{message}"))
                .build(),
        );
    }

    #[test]
    fn formats_epoch_and_leap_day_timestamps() {
        assert_eq!(format_timestamp(UNIX_EPOCH), "1970-01-01T00:00:00Z");
        assert_eq!(
            format_timestamp(UNIX_EPOCH + Duration::from_secs(1_709_210_096)),
            "2024-02-29T12:34:56Z"
        );
    }

    #[test]
    fn writes_records_at_or_below_the_level() {
        let dir = temp_dir("level");
        let logger = FileLogger::new(&dir, LevelFilter::Info, MAX_LOG_BYTES, false);

        write_record(&logger, log::Level::Info, "kept");
        write_record(&logger, log::Level::Debug, "dropped");

        let contents = fs::read_to_string(dir.join("claudio.log")).unwrap_or_default();
        assert!(contents.contains("[INFO][test] kept"));
        assert!(!contents.contains("dropped"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rotates_once_and_keeps_a_single_old_file() {
        let dir = temp_dir("rotate");
        let logger = FileLogger::new(&dir, LevelFilter::Info, 200, false);

        for index in 0..30 {
            write_record(&logger, log::Level::Info, &format!("record number {index}"));
        }

        let current = fs::read_to_string(dir.join("claudio.log")).unwrap_or_default();
        let rotated = fs::read_to_string(dir.join("claudio.old.log")).unwrap_or_default();
        assert!(current.contains("record number 29"));
        assert!(!rotated.is_empty());
        assert!(current.len() <= 200 + 80);
        let entries = fs::read_dir(&dir).map(|d| d.count()).unwrap_or(0);
        assert_eq!(entries, 2);
        let _ = fs::remove_dir_all(&dir);
    }
}
