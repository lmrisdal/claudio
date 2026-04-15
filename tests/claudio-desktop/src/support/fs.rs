use std::path::PathBuf;
use tempfile::TempDir;

pub struct TestWorkspace {
    _root: TempDir,
    pub data_dir: PathBuf,
}

impl Default for TestWorkspace {
    fn default() -> Self {
        Self::new()
    }
}

impl TestWorkspace {
    pub fn new() -> Self {
        let root = tempfile::tempdir().expect("tempdir should be created");
        let data_dir = root.path().join("desktop-data");
        Self {
            _root: root,
            data_dir,
        }
    }
}
