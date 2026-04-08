use super::*;
#[cfg(any(test, feature = "integration-tests"))]
use std::sync::{LazyLock, Mutex};

#[cfg(any(test, feature = "integration-tests"))]
static START_MENU_DIR_OVERRIDE: LazyLock<Mutex<Option<PathBuf>>> =
    LazyLock::new(|| Mutex::new(None));

#[cfg(any(test, feature = "integration-tests"))]
static DESKTOP_DIR_OVERRIDE: LazyLock<Mutex<Option<PathBuf>>> = LazyLock::new(|| Mutex::new(None));

#[cfg(any(test, feature = "integration-tests"))]
static TEST_SHELL_DIRS_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

#[cfg(any(test, feature = "integration-tests"))]
struct TestShellDirsGuard {
    _lock: std::sync::MutexGuard<'static, ()>,
}

#[cfg(any(test, feature = "integration-tests"))]
impl TestShellDirsGuard {
    fn new(start_menu_dir: PathBuf, desktop_dir: PathBuf) -> Self {
        let lock = TEST_SHELL_DIRS_LOCK
            .lock()
            .expect("test shell dirs lock should not be poisoned");

        if let Ok(mut override_dir) = START_MENU_DIR_OVERRIDE.lock() {
            *override_dir = Some(start_menu_dir);
        }
        if let Ok(mut override_dir) = DESKTOP_DIR_OVERRIDE.lock() {
            *override_dir = Some(desktop_dir);
        }

        Self { _lock: lock }
    }
}

#[cfg(any(test, feature = "integration-tests"))]
impl Drop for TestShellDirsGuard {
    fn drop(&mut self) {
        if let Ok(mut override_dir) = START_MENU_DIR_OVERRIDE.lock() {
            *override_dir = None;
        }
        if let Ok(mut override_dir) = DESKTOP_DIR_OVERRIDE.lock() {
            *override_dir = None;
        }
    }
}

#[cfg(any(test, feature = "integration-tests"))]
pub(crate) fn with_test_shell_dirs<T>(
    start_menu_dir: PathBuf,
    desktop_dir: PathBuf,
    run: impl FnOnce() -> T,
) -> T {
    let _guard = TestShellDirsGuard::new(start_menu_dir, desktop_dir);
    run()
}

pub(crate) fn start_menu_shortcut_path(title: &str) -> PathBuf {
    #[cfg(any(test, feature = "integration-tests"))]
    if let Ok(override_dir) = START_MENU_DIR_OVERRIDE.lock() {
        if let Some(path) = override_dir.clone() {
            return path.join(format!("{title}.lnk"));
        }
    }

    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from(r"C:\Users\Default\AppData\Roaming"))
        .join(r"Microsoft\Windows\Start Menu\Programs")
        .join(format!("{title}.lnk"))
}

pub(crate) fn desktop_shortcut_path(title: &str) -> PathBuf {
    #[cfg(any(test, feature = "integration-tests"))]
    if let Ok(override_dir) = DESKTOP_DIR_OVERRIDE.lock() {
        if let Some(path) = override_dir.clone() {
            return path.join(format!("{title}.lnk"));
        }
    }

    dirs::desktop_dir()
        .unwrap_or_else(|| PathBuf::from(r"C:\Users\Default\Desktop"))
        .join(format!("{title}.lnk"))
}
