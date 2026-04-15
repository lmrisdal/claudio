use super::*;

pub struct InstallState {
    installs: Mutex<HashMap<i32, InstallControl>>,
    exit_approved: AtomicBool,
}

impl Default for InstallState {
    fn default() -> Self {
        Self {
            installs: Mutex::new(HashMap::new()),
            exit_approved: AtomicBool::new(false),
        }
    }
}

struct ActiveInstallGuard<'a> {
    state: &'a InstallState,
    should_release: bool,
}

impl Drop for ActiveInstallGuard<'_> {
    fn drop(&mut self) {
        if self.should_release {
            self.state.release_active_operation();
        }
    }
}

#[derive(Clone)]
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(super) struct InstallControl {
    pub(super) cancel_token: Arc<AtomicBool>,
    restart_interactive: Arc<AtomicBool>,
    tracked_installer: Arc<Mutex<TrackedInstallerState>>,
}

#[derive(Default)]
struct TrackedInstallerState {
    pids: BTreeSet<u32>,
    exe_name: Option<String>,
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
impl InstallControl {
    pub(super) fn new() -> Self {
        Self {
            cancel_token: Arc::new(AtomicBool::new(false)),
            restart_interactive: Arc::new(AtomicBool::new(false)),
            tracked_installer: Arc::new(Mutex::new(TrackedInstallerState::default())),
        }
    }

    pub(super) fn is_cancelled(&self) -> bool {
        self.cancel_token.load(Ordering::Relaxed)
    }

    pub(super) fn set_cancelled(&self, value: bool) {
        self.cancel_token.store(value, Ordering::Relaxed);
    }

    pub(super) fn request_restart_interactive(&self) {
        self.restart_interactive.store(true, Ordering::Relaxed);
        self.cancel_token.store(true, Ordering::Relaxed);
    }

    pub(super) fn take_restart_interactive_request(&self) -> bool {
        self.restart_interactive.swap(false, Ordering::Relaxed)
    }

    pub(super) fn set_installer_process(&self, pid: u32, exe_name: Option<String>) {
        if let Ok(mut tracked) = self.tracked_installer.lock() {
            tracked.pids.clear();
            if pid != 0 {
                tracked.pids.insert(pid);
            }
            tracked.exe_name = exe_name;
        }
    }

    pub(super) fn refresh_tracked_processes(&self) {
        #[cfg(target_os = "windows")]
        if let Ok(mut tracked) = self.tracked_installer.lock() {
            let current: Vec<u32> = tracked.pids.iter().copied().collect();
            tracked.pids = crate::windows_integration::collect_tracked_processes(
                &current,
                tracked.exe_name.as_deref(),
            )
            .into_iter()
            .collect();
        }
    }

    pub(super) fn clear_installer_processes(&self) {
        if let Ok(mut tracked) = self.tracked_installer.lock() {
            tracked.pids.clear();
            tracked.exe_name = None;
        }
    }

    pub(super) fn installer_snapshot(&self) -> (Vec<u32>, Option<String>) {
        self.tracked_installer
            .lock()
            .map(|tracked| {
                (
                    tracked.pids.iter().copied().collect(),
                    tracked.exe_name.clone(),
                )
            })
            .unwrap_or_else(|_| (Vec::new(), None))
    }
}

impl InstallState {
    pub(super) fn start(&self, game_id: i32) -> Result<InstallControl, String> {
        let mut installs = self
            .installs
            .lock()
            .map_err(|_| "Install state lock poisoned.".to_string())?;
        if installs.contains_key(&game_id) {
            return Err("This game is already being installed.".to_string());
        }
        let should_acquire = installs.is_empty();
        let mut guard = ActiveInstallGuard {
            state: self,
            should_release: false,
        };
        if should_acquire {
            self.acquire_active_operation()?;
            guard.should_release = true;
        }
        let control = InstallControl::new();
        installs.insert(game_id, control.clone());
        guard.should_release = false;
        Ok(control)
    }

    pub(super) fn finish(&self, game_id: i32) {
        if let Ok(mut installs) = self.installs.lock() {
            let removed = installs.remove(&game_id).is_some();
            let should_release = removed && installs.is_empty();
            drop(installs);
            if should_release {
                self.release_active_operation();
            }
        }
    }

    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    pub fn has_active_operations(&self) -> bool {
        self.installs
            .lock()
            .map(|installs| !installs.is_empty())
            .unwrap_or(false)
    }

    pub fn approve_exit(&self) {
        self.exit_approved.store(true, Ordering::Relaxed);
    }

    pub fn take_exit_approval(&self) -> bool {
        self.exit_approved.swap(false, Ordering::Relaxed)
    }

    pub(super) fn cancel(&self, app: &AppHandle, game_id: i32) -> Result<(), String> {
        let installs = self
            .installs
            .lock()
            .map_err(|_| "Install state lock poisoned.".to_string())?;
        if let Some(control) = installs.get(&game_id) {
            log::info!("[installer {game_id}] stop requested");
            control.set_cancelled(true);
            emit_progress_indeterminate(
                app,
                game_id,
                "stopping",
                None,
                Some("Stopping installation..."),
                true,
            );
            terminate_external_installer(control);
            Ok(())
        } else {
            Err("No active install for this game.".to_string())
        }
    }

    pub(super) fn restart_interactive(&self, app: &AppHandle, game_id: i32) -> Result<(), String> {
        let installs = self
            .installs
            .lock()
            .map_err(|_| "Install state lock poisoned.".to_string())?;
        if let Some(control) = installs.get(&game_id) {
            log::info!("[installer {game_id}] restart interactive requested");
            control.request_restart_interactive();
            emit_progress_indeterminate(
                app,
                game_id,
                "stopping",
                None,
                Some("Stopping installation to restart interactively..."),
                true,
            );
            terminate_external_installer(control);
            Ok(())
        } else {
            Err("No active install for this game.".to_string())
        }
    }

    fn acquire_active_operation(&self) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        crate::windows_integration::prevent_system_sleep()?;

        Ok(())
    }

    fn release_active_operation(&self) {
        #[cfg(target_os = "windows")]
        if let Err(error) = crate::windows_integration::allow_system_sleep() {
            log::warn!("[installer] failed to clear Windows sleep prevention: {error}");
        }
    }
}

#[cfg(target_os = "windows")]
pub(super) fn terminate_external_installer(control: &InstallControl) {
    control.refresh_tracked_processes();
    let (pids, exe_name) = control.installer_snapshot();
    log::info!(
        "[installer] force terminating tracked processes {:?} (exe_name={:?})",
        pids,
        exe_name
    );
    let _ = crate::windows_integration::terminate_tracked_processes(&pids, exe_name.as_deref());
}

#[cfg(not(target_os = "windows"))]
pub(super) fn terminate_external_installer(_control: &InstallControl) {}
