#![cfg_attr(test, allow(dead_code))]

use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::thread;

const LOG_TAIL_LINES: usize = 40;

pub(crate) type LogTail = Arc<Mutex<VecDeque<String>>>;

pub(crate) struct LoggedChild {
    pub(crate) child: Child,
    pub(crate) log_tail: LogTail,
}

pub(crate) fn spawn_logged_child(
    mut command: Command,
    process_name: &'static str,
) -> Result<LoggedChild, std::io::Error> {
    let mut child = command.spawn()?;
    let log_tail = Arc::new(Mutex::new(VecDeque::with_capacity(LOG_TAIL_LINES)));

    if let Some(stdout) = child.stdout.take() {
        spawn_log_reader(process_name, "stdout", stdout, Arc::clone(&log_tail));
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_log_reader(process_name, "stderr", stderr, Arc::clone(&log_tail));
    }

    Ok(LoggedChild { child, log_tail })
}

pub(crate) fn format_log_tail(process_name: &str, log_tail: &LogTail) -> String {
    let Ok(tail) = log_tail.lock() else {
        return format!("{process_name} output is available in claudio.log.");
    };
    if tail.is_empty() {
        return format!(
            "No {process_name} output was captured. Check claudio.log for earlier context."
        );
    }

    format!(
        "Last {process_name} output lines from claudio.log:\n{}",
        tail.iter().cloned().collect::<Vec<_>>().join("\n")
    )
}

fn spawn_log_reader(
    process_name: &'static str,
    label: &'static str,
    stream: impl Read + Send + 'static,
    log_tail: LogTail,
) {
    thread::spawn(move || {
        for line in BufReader::new(stream).lines() {
            match line {
                Ok(line) => {
                    push_log_tail(&log_tail, label, &line);
                    match label {
                        "stderr" if stderr_is_problem(&line) => {
                            log::warn!("[{process_name} stderr] {line}")
                        }
                        "stderr" => log::info!("[{process_name} stderr] {line}"),
                        _ => log::info!("[{process_name} stdout] {line}"),
                    }
                }
                Err(error) => {
                    log::warn!("[{process_name} {label}] failed reading process output: {error}");
                    break;
                }
            }
        }
    });
}

// Tools such as umu write their routine INFO output to stderr, so only lines that
// look like problems are worth a warning.
fn stderr_is_problem(line: &str) -> bool {
    ["WARN", "ERROR", "Error", "Traceback", "mismatch"]
        .iter()
        .any(|marker| line.contains(marker))
}

fn push_log_tail(log_tail: &LogTail, label: &str, line: &str) {
    let Ok(mut tail) = log_tail.lock() else {
        return;
    };
    if tail.len() == LOG_TAIL_LINES {
        tail.pop_front();
    }
    tail.push_back(format!("{label}: {line}"));
}

#[cfg(test)]
mod tests {
    use super::stderr_is_problem;

    #[test]
    fn routine_info_lines_are_not_problems() {
        assert!(!stderr_is_problem("INFO: Updating steamrt4 to latest..."));
        assert!(!stderr_is_problem(
            "ProtonFixes[1] INFO: All checks successful"
        ));
        assert!(!stderr_is_problem(""));
    }

    #[test]
    fn warnings_and_errors_are_problems() {
        assert!(stderr_is_problem("ERROR: Digest mismatched: foo.tar.xz"));
        assert!(stderr_is_problem(
            "ProtonFixes[1] WARN: Game title not found in CSV"
        ));
        assert!(stderr_is_problem(
            "Proton: Error: unable to use parent for game drive"
        ));
        assert!(stderr_is_problem("Traceback (most recent call last):"));
    }
}
