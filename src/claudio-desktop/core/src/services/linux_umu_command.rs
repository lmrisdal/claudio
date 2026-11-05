use super::resolve_umu_run;
use std::fs;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::Duration;

pub fn run_prefix_command(
    prefix: &Path,
    proton_path: &str,
    exe: &Path,
    extra_args: &[String],
    game_id: Option<&str>,
    store: Option<&str>,
) -> Result<Child, String> {
    spawn_prefix_command(prefix, proton_path, exe, extra_args, game_id, store)
        .map(|logged| logged.child)
}

fn spawn_prefix_command(
    prefix: &Path,
    proton_path: &str,
    exe: &Path,
    extra_args: &[String],
    game_id: Option<&str>,
    store: Option<&str>,
) -> Result<crate::services::process_log::LoggedChild, String> {
    let umu_run = resolve_umu_run()?;
    let runtime_prefix = crate::services::linux_host_paths::nested_runtime_path(prefix);
    let runtime_exe = crate::services::linux_host_paths::nested_runtime_path(exe);
    let working_dir = exe.parent().unwrap_or_else(|| Path::new("."));
    let mut command = prefix_command(&umu_run, &runtime_exe, extra_args);
    command
        .current_dir(working_dir)
        .env("WINEPREFIX", &runtime_prefix)
        .env("PROTONPATH", proton_path)
        .env("GAMEID", game_id.unwrap_or("umu-default"))
        .env("STORE", store.unwrap_or("none"))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    log::info!(
        "[umu] starting {} with prefix {} and Proton {proton_path}",
        runtime_exe.display(),
        runtime_prefix.display()
    );
    crate::services::process_log::spawn_logged_child(command, "umu").map_err(|err| {
        format!(
            "Failed to start UMU for {} with prefix {}: {err}",
            runtime_exe.display(),
            runtime_prefix.display()
        )
    })
}

fn prefix_command(umu_run: &Path, exe: &Path, extra_args: &[String]) -> Command {
    let mut command = Command::new(umu_run);
    if exe
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("msi"))
    {
        command.arg("msiexec").arg("/i");
    }
    command.arg(exe).args(extra_args);
    command
}

pub fn run_prefix_command_wait(
    prefix: &Path,
    proton_path: &str,
    exe: &Path,
    extra_args: &[String],
    cancelled: impl Fn() -> bool,
) -> Result<(), String> {
    let mut process = spawn_prefix_command(prefix, proton_path, exe, extra_args, None, None)?;

    loop {
        if cancelled() {
            let _ = process.child.kill();
            let _ = process.child.wait();
            return Err("Install cancelled.".to_string());
        }

        match process.child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(status)) => {
                return Err(format!(
                    "UMU exited with status {status} while running {}.\n{}",
                    exe.display(),
                    process.failure_output("UMU")
                ));
            }
            Ok(None) => thread::sleep(Duration::from_millis(250)),
            Err(err) => return Err(format!("Failed waiting for UMU: {err}")),
        }
    }
}

pub fn prepare_prefix(
    prefix: &Path,
    proton_path: &str,
    cancelled: impl Fn() -> bool,
) -> Result<(), String> {
    fs::create_dir_all(prefix)
        .map_err(|err| format!("Failed to create Wine prefix {}: {err}", prefix.display()))?;
    let umu_run = resolve_umu_run()?;
    let runtime_prefix = crate::services::linux_host_paths::nested_runtime_path(prefix);
    let mut command = Command::new(umu_run);
    command
        .arg("createprefix")
        .current_dir(prefix)
        .env("WINEPREFIX", &runtime_prefix)
        .env("PROTONPATH", proton_path)
        .env("GAMEID", "umu-default")
        .env("STORE", "none")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    log::info!(
        "[umu] preparing prefix {} with Proton {proton_path}",
        runtime_prefix.display()
    );
    let mut process =
        crate::services::process_log::spawn_logged_child(command, "umu").map_err(|err| {
            format!(
                "Failed to prepare UMU prefix {} with Proton {proton_path}: {err}",
                runtime_prefix.display()
            )
        })?;

    loop {
        if cancelled() {
            let _ = process.child.kill();
            let _ = process.child.wait();
            return Err("Install cancelled.".to_string());
        }

        match process.child.try_wait() {
            Ok(Some(status)) if status.success() || prefix_is_initialised(prefix) => return Ok(()),
            Ok(Some(status)) => {
                return Err(format!(
                    "UMU exited with status {status} while preparing prefix {}.\n{}",
                    runtime_prefix.display(),
                    process.failure_output("UMU")
                ));
            }
            Ok(None) => thread::sleep(Duration::from_millis(250)),
            Err(err) => return Err(format!("Failed waiting for UMU: {err}")),
        }
    }
}
// Proton exits 1 after creating the prefix because there is no executable to run, so judge
// success by the prefix itself.
fn prefix_is_initialised(prefix: &Path) -> bool {
    prefix.join("pfx").join("system.reg").is_file() || prefix.join("system.reg").is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefix_is_initialised_when_system_registry_exists() {
        let root = std::env::temp_dir().join(format!("claudio-prefix-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("pfx")).unwrap();
        assert!(!prefix_is_initialised(&root));

        fs::write(root.join("pfx").join("system.reg"), b"").unwrap();
        assert!(prefix_is_initialised(&root));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn msi_uses_msiexec_and_preserves_spaced_paths() {
        let command = prefix_command(
            Path::new("umu-run"),
            Path::new("/downloads/My Game.MSI"),
            &[r"TARGETDIR=C:\Games\My Game".to_string()],
        );
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            [
                "msiexec",
                "/i",
                "/downloads/My Game.MSI",
                r"TARGETDIR=C:\Games\My Game",
            ]
        );
    }

    #[test]
    fn exe_receives_destination_as_one_argument() {
        let command = prefix_command(
            Path::new("umu-run"),
            Path::new("/downloads/setup.exe"),
            &[r"/DIR=C:\Games\My Game".to_string()],
        );
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            ["/downloads/setup.exe", r"/DIR=C:\Games\My Game",]
        );
    }
}
