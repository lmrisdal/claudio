use std::path::{Path, PathBuf};

pub(crate) fn nested_runtime_path(path: &Path) -> PathBuf {
    path.strip_prefix("/run/host")
        .map(host_root_path)
        .unwrap_or_else(|_| path.to_path_buf())
}

fn host_root_path(path: &Path) -> PathBuf {
    if path.as_os_str().is_empty() {
        PathBuf::from("/")
    } else {
        Path::new("/").join(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nested_runtime_path_strips_distrobox_host_root() {
        assert_eq!(
            nested_runtime_path(Path::new("/run/host/var/mnt/games")),
            PathBuf::from("/var/mnt/games")
        );
    }

    #[test]
    fn nested_runtime_path_keeps_regular_absolute_path() {
        assert_eq!(
            nested_runtime_path(Path::new("/home/lars/Games")),
            PathBuf::from("/home/lars/Games")
        );
    }

    #[test]
    fn nested_runtime_path_maps_host_root_to_root() {
        assert_eq!(
            nested_runtime_path(Path::new("/run/host")),
            PathBuf::from("/")
        );
    }
}
