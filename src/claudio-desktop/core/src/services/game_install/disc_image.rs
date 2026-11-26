use super::installer_detect::detect_installer;
use super::*;
use std::process::{Command, Output};

pub(super) struct InstallerSource {
    pub(super) root: PathBuf,
    pub(super) installer_hint: Option<String>,
    _disc: Option<MountedDisc>,
}

pub(super) fn is_disc_image(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("iso"))
}

pub(super) fn prepare_installer_source<F>(
    package_path: &Path,
    staging_dir: &Path,
    installer_hint: Option<&str>,
    cancel_token: &Arc<AtomicBool>,
    progress: F,
) -> Result<InstallerSource, String>
where
    F: FnMut(f64),
{
    let image = if is_disc_image(package_path) {
        package_path.to_path_buf()
    } else {
        extract_archive_or_copy(package_path, staging_dir, cancel_token, progress)?;
        match disc_image_for_installer(staging_dir, installer_hint) {
            Some(image) => image,
            None => {
                return Ok(InstallerSource {
                    root: staging_dir.to_path_buf(),
                    installer_hint: installer_hint.map(str::to_string),
                    _disc: None,
                });
            }
        }
    };

    let installer_hint = installer_hint
        .filter(|hint| !is_disc_image(Path::new(hint)))
        .map(str::to_string);

    match MountedDisc::mount(&image) {
        Ok(disc) => {
            log::info!(
                "[installer] mounted {} at {}",
                image.display(),
                disc.root.display()
            );
            Ok(InstallerSource {
                root: disc.root.clone(),
                installer_hint,
                _disc: Some(disc),
            })
        }
        Err(mount_error) => {
            log::warn!(
                "[installer] could not mount {} ({mount_error}); extracting it instead",
                image.display()
            );
            let destination = staging_dir.join("disc");
            extract_disc_image(&image, &destination, cancel_token).map_err(|extract_error| {
                format!(
                    "Could not open the disc image. Mounting failed: {mount_error} Extracting failed: {extract_error}"
                )
            })?;
            Ok(InstallerSource {
                root: destination,
                installer_hint,
                _disc: None,
            })
        }
    }
}

pub(super) fn disc_image_for_installer(
    root: &Path,
    installer_hint: Option<&str>,
) -> Option<PathBuf> {
    if let Some(hint) = installer_hint {
        let hinted = root.join(hint);
        if hinted.is_file() {
            return is_disc_image(&hinted).then_some(hinted);
        }
    }

    let mut images = Vec::new();
    collect_matching_files(root, &mut images, is_disc_image);
    if images.is_empty() || detect_installer(root).is_some() {
        return None;
    }

    images.sort_by_key(|path| path.to_string_lossy().to_ascii_lowercase());
    images.into_iter().next()
}

struct MountedDisc {
    root: PathBuf,
    #[cfg(target_os = "windows")]
    image: PathBuf,
    #[cfg(target_os = "windows")]
    owned: bool,
    #[cfg(target_os = "linux")]
    loop_device: String,
}

#[cfg(target_os = "windows")]
const MOUNT_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$path = $env:CLAUDIO_DISC_IMAGE
$image = Get-DiskImage -ImagePath $path
$owned = $false
if (-not $image.Attached) {
    $image = Mount-DiskImage -ImagePath $path -StorageType ISO -PassThru
    $owned = $true
}
$letter = $null
for ($i = 0; $i -lt 50 -and -not $letter; $i++) {
    $letter = ($image | Get-Volume).DriveLetter
    if (-not $letter) { Start-Sleep -Milliseconds 200; $image = Get-DiskImage -ImagePath $path }
}
if (-not $letter) { throw 'The disc image was attached but Windows gave it no drive letter.' }
"$owned|$letter"
"#;

#[cfg(target_os = "windows")]
impl MountedDisc {
    fn mount(image: &Path) -> Result<Self, String> {
        let output = run_powershell(MOUNT_SCRIPT, image)?;
        let (owned, letter) = output
            .trim()
            .rsplit_once('|')
            .ok_or_else(|| format!("Unexpected mount output: {}", output.trim()))?;
        Ok(Self {
            root: PathBuf::from(format!("{}:\\", letter.trim())),
            image: image.to_path_buf(),
            owned: owned.trim().eq_ignore_ascii_case("true"),
        })
    }
}

#[cfg(target_os = "windows")]
impl Drop for MountedDisc {
    fn drop(&mut self) {
        if !self.owned {
            return;
        }
        if let Err(error) = run_powershell(
            "Dismount-DiskImage -ImagePath $env:CLAUDIO_DISC_IMAGE | Out-Null",
            &self.image,
        ) {
            log::warn!(
                "[installer] failed to unmount {}: {error}",
                self.image.display()
            );
        }
    }
}

#[cfg(target_os = "windows")]
fn run_powershell(script: &str, image: &Path) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    use windows::Win32::System::Threading::CREATE_NO_WINDOW;

    let mut command = Command::new("powershell.exe");
    command
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .env("CLAUDIO_DISC_IMAGE", image)
        .stdin(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW.0);
    command_stdout(command, "PowerShell")
}

#[cfg(target_os = "linux")]
impl MountedDisc {
    fn mount(image: &Path) -> Result<Self, String> {
        let mut setup = Command::new("udisksctl");
        setup
            .args([
                "loop-setup",
                "--no-user-interaction",
                "--read-only",
                "--file",
            ])
            .arg(image);
        let output = command_stdout(setup, "udisksctl loop-setup")?;
        let loop_device = parse_loop_device(&output)
            .ok_or_else(|| format!("Unexpected udisksctl output: {}", output.trim()))?;

        let mut disc = Self {
            root: PathBuf::new(),
            loop_device,
        };
        disc.root = disc.mount_loop_device()?;
        Ok(disc)
    }

    fn mount_loop_device(&self) -> Result<PathBuf, String> {
        for _ in 0..5 {
            if let Some(mount_point) = mount_point_of(&self.loop_device) {
                return Ok(mount_point);
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        let mut mount = Command::new("udisksctl");
        mount.args([
            "mount",
            "--no-user-interaction",
            "--block-device",
            &self.loop_device,
        ]);
        match command_stdout(mount, "udisksctl mount") {
            Ok(output) => parse_mount_point(&output)
                .ok_or_else(|| format!("Unexpected udisksctl output: {}", output.trim())),
            Err(error) => mount_point_of(&self.loop_device).ok_or(error),
        }
    }
}

#[cfg(target_os = "linux")]
impl Drop for MountedDisc {
    fn drop(&mut self) {
        if !self.root.as_os_str().is_empty() {
            let mut unmount = Command::new("udisksctl");
            unmount.args([
                "unmount",
                "--no-user-interaction",
                "--block-device",
                &self.loop_device,
            ]);
            if let Err(error) = command_stdout(unmount, "udisksctl unmount") {
                log::warn!(
                    "[installer] failed to unmount {}: {error}",
                    self.loop_device
                );
            }
        }

        let mut delete = Command::new("udisksctl");
        delete.args([
            "loop-delete",
            "--no-user-interaction",
            "--block-device",
            &self.loop_device,
        ]);
        if let Err(error) = command_stdout(delete, "udisksctl loop-delete") {
            log::warn!(
                "[installer] failed to remove loop device {}: {error}",
                self.loop_device
            );
        }
    }
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
impl MountedDisc {
    fn mount(_image: &Path) -> Result<Self, String> {
        Err("Mounting disc images is not supported on this platform.".to_string())
    }
}

#[cfg(any(target_os = "linux", test))]
pub(super) fn parse_loop_device(output: &str) -> Option<String> {
    output
        .split_whitespace()
        .find(|word| word.starts_with("/dev/"))
        .map(|word| word.trim_end_matches('.').to_string())
}

#[cfg(any(target_os = "linux", test))]
pub(super) fn parse_mount_point(output: &str) -> Option<PathBuf> {
    let (_, path) = output.trim().split_once(" at ")?;
    let path = path.strip_suffix('.').unwrap_or(path);
    Some(PathBuf::from(path.trim_matches(|c| c == '`' || c == '\'')))
}

#[cfg(target_os = "linux")]
fn mount_point_of(device: &str) -> Option<PathBuf> {
    let mounts = fs::read_to_string("/proc/self/mounts").ok()?;
    mount_point_in(&mounts, device)
}

#[cfg(any(target_os = "linux", test))]
pub(super) fn mount_point_in(mounts: &str, device: &str) -> Option<PathBuf> {
    mounts.lines().find_map(|line| {
        let mut fields = line.split(' ');
        let source = fields.next()?;
        let target = fields.next()?;
        (source == device).then(|| PathBuf::from(unescape_mount_field(target)))
    })
}

#[cfg(any(target_os = "linux", test))]
fn unescape_mount_field(field: &str) -> String {
    let mut result = String::with_capacity(field.len());
    let mut rest = field;
    while let Some(index) = rest.find('\\') {
        result.push_str(&rest[..index]);
        let code = rest.get(index + 1..index + 4);
        match code.and_then(|digits| u8::from_str_radix(digits, 8).ok()) {
            Some(byte) => {
                result.push(byte as char);
                rest = &rest[index + 4..];
            }
            None => {
                result.push('\\');
                rest = &rest[index + 1..];
            }
        }
    }
    result.push_str(rest);
    result
}

pub(super) fn extract_disc_image(
    image: &Path,
    destination: &Path,
    cancel_token: &Arc<AtomicBool>,
) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|err| {
        log_io_failure("create disc extraction folder", destination, &err);
        format_install_io_error("create the disc extraction folder", destination, &err)
    })?;

    let mut failures = Vec::new();
    for (program, args) in disc_extractors(image, destination) {
        let mut command = Command::new(program);
        command
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(windows::Win32::System::Threading::CREATE_NO_WINDOW.0);
        }

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => {
                failures.push(format!("{program}: {error}"));
                continue;
            }
        };

        loop {
            if cancel_token.load(Ordering::Relaxed) {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Install cancelled.".to_string());
            }
            match child.try_wait() {
                Ok(Some(status)) if status.success() => return Ok(()),
                Ok(Some(status)) => {
                    let mut stderr = String::new();
                    if let Some(mut pipe) = child.stderr.take() {
                        let _ = io::Read::read_to_string(&mut pipe, &mut stderr);
                    }
                    failures.push(format!("{program} exited with {status}: {}", stderr.trim()));
                    break;
                }
                Ok(None) => std::thread::sleep(std::time::Duration::from_millis(200)),
                Err(error) => {
                    failures.push(format!("{program}: {error}"));
                    break;
                }
            }
        }
    }

    if failures.is_empty() {
        Err("Install 7-Zip or bsdtar (libarchive) so Claudio can extract it.".to_string())
    } else {
        Err(failures.join("; "))
    }
}

fn disc_extractors(
    image: &Path,
    destination: &Path,
) -> Vec<(&'static str, Vec<std::ffi::OsString>)> {
    let seven_zip_args = vec![
        "x".into(),
        "-y".into(),
        format!("-o{}", destination.display()).into(),
        image.as_os_str().to_owned(),
    ];
    let tar_args = vec![
        "-xf".into(),
        image.as_os_str().to_owned(),
        "-C".into(),
        destination.as_os_str().to_owned(),
    ];

    let mut extractors = vec![("7zz", seven_zip_args.clone()), ("7z", seven_zip_args)];
    if cfg!(target_os = "windows") {
        extractors.push(("tar", tar_args));
    } else {
        extractors.push(("bsdtar", tar_args));
    }
    extractors
}

#[cfg_attr(not(any(target_os = "windows", target_os = "linux")), allow(dead_code))]
fn command_stdout(mut command: Command, name: &str) -> Result<String, String> {
    let Output {
        status,
        stdout,
        stderr,
    } = command
        .output()
        .map_err(|error| format!("Could not run {name}: {error}."))?;
    if status.success() {
        Ok(String::from_utf8_lossy(&stdout).into_owned())
    } else {
        Err(format!(
            "{name} exited with {status}: {}",
            String::from_utf8_lossy(&stderr).trim()
        ))
    }
}
