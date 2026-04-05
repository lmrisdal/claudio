use std::fs;
use std::path::Path;

pub fn write_fake_exe_installer_fixture(path: &Path) {
    fs::write(path, b"MZ fake exe installer fixture")
        .expect("fake exe installer fixture should be written");
}

pub fn write_fake_msi_installer_fixture(path: &Path) {
    fs::write(path, b"MSI fake installer fixture")
        .expect("fake msi installer fixture should be written");
}

pub fn write_fake_gog_inno_installer_fixture(path: &Path) {
    fs::write(path, b"MZ GOG.com Inno Setup fake installer fixture")
        .expect("fake gog inno installer fixture should be written");
}

pub fn write_fake_innoextract_script(path: &Path) {
    fs::write(
        path,
        concat!(
            "@echo off\r\n",
            "set target=%~2\r\n",
            "mkdir \"%target%\\app\"\r\n",
            "mkdir \"%target%\\tmp\"\r\n",
            "copy NUL \"%target%\\app\\game.exe\" > NUL\r\n",
            "copy NUL \"%target%\\tmp\\leftover.tmp\" > NUL\r\n",
            "exit /b 0\r\n"
        ),
    )
    .expect("fake innoextract script should be written");
}
