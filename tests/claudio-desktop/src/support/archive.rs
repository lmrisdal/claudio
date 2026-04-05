use flate2::{Compression, write::GzEncoder};
use std::fs;
use std::io::Write;
use std::path::Path;
use zip::write::SimpleFileOptions;

pub fn write_zip_archive(path: &Path, entries: &[(&str, &[u8])]) {
    let file = fs::File::create(path).expect("zip file should be created");
    let mut archive = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default();

    for (name, contents) in entries {
        archive
            .start_file(name, options)
            .expect("zip entry should start");
        archive
            .write_all(contents)
            .expect("zip entry should be written");
    }

    archive.finish().expect("zip archive should finish");
}

pub fn write_tar_gz_archive(path: &Path, entries: &[(&str, &[u8])]) {
    let file = fs::File::create(path).expect("tar.gz file should be created");
    let encoder = GzEncoder::new(file, Compression::default());
    let mut archive = tar::Builder::new(encoder);

    for (name, contents) in entries {
        let mut header = tar::Header::new_gnu();
        header.set_size(contents.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        archive
            .append_data(&mut header, name, std::io::Cursor::new(*contents))
            .expect("tar entry should be written");
    }

    archive.finish().expect("tar archive should finish");
}
