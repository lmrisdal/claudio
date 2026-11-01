#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use claudio_core::{logging, rpc, settings};
use std::path::PathBuf;
use std::time::Duration;
use tokio::io::BufReader;

fn resource_dir_from_args() -> PathBuf {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--resource-dir" {
            return args.next().map(PathBuf::from).unwrap_or_default();
        }
        if let Some(value) = arg.strip_prefix("--resource-dir=") {
            return PathBuf::from(value);
        }
    }
    PathBuf::new()
}

fn main() {
    let initial_settings = settings::load();
    logging::init(
        &settings::data_dir(),
        settings::log_level_filter(&initial_settings),
    );
    log::info!("claudio-core {} started", env!("CARGO_PKG_VERSION"));

    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            log::error!("Failed to start the async runtime: {error}");
            std::process::exit(1);
        }
    };

    runtime.block_on(rpc::serve(
        BufReader::new(tokio::io::stdin()),
        tokio::io::stdout(),
        resource_dir_from_args(),
    ));

    log::info!("claudio-core stdin closed, exiting");
    runtime.shutdown_timeout(Duration::from_millis(500));
}
