use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

use sea_orm::{ActiveModelTrait, ActiveValue::Set, DatabaseConnection, EntityTrait};
use serde::Serialize;
use thiserror::Error;
use tokio::sync::mpsc;
use tracing::{error, info, warn};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

use crate::{entity::game, util::file_browse};

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressionStatus {
    pub current: Option<CompressionJobInfo>,
    pub queued: Vec<CompressionJobInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressionJobInfo {
    pub game_id: i32,
    pub game_title: String,
    pub progress_percent: Option<u8>,
    pub format: String,
}

pub struct CompressionService {
    db: DatabaseConnection,
    sender: mpsc::UnboundedSender<CompressionRequest>,
    receiver: Mutex<Option<mpsc::UnboundedReceiver<CompressionRequest>>>,
    state: Mutex<CompressionStatus>,
    cancellations: dashmap::DashMap<i32, Arc<AtomicBool>>,
}

#[derive(Debug, Clone)]
struct CompressionRequest {
    game_id: i32,
    format: String,
}

#[derive(Debug, Error)]
pub enum CompressionError {
    #[error("Game not found.")]
    GameNotFound,
    #[error("Game is already queued for compression.")]
    AlreadyQueued,
    #[error("Game folder not found on disk.")]
    GameMissingOnDisk,
    #[error("Game is already a standalone archive.")]
    StandaloneArchive,
    #[error("Game is already a single archive.")]
    SingleArchive,
    #[error("Format must be 'zip' or 'tar'.")]
    InvalidFormat,
    #[error("database error: {0}")]
    Database(#[from] sea_orm::DbErr),
    #[error("packaging failed: {0}")]
    Packaging(String),
}

#[derive(Debug, Error)]
enum PackagingError {
    #[error("cancelled")]
    Cancelled,
    #[error("no files to package")]
    NoFiles,
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Zip(#[from] zip::result::ZipError),
}

impl CompressionService {
    pub fn new(db: DatabaseConnection) -> Self {
        let (sender, receiver) = mpsc::unbounded_channel();
        Self {
            db,
            sender,
            receiver: Mutex::new(Some(receiver)),
            state: Mutex::new(CompressionStatus::default()),
            cancellations: dashmap::DashMap::new(),
        }
    }

    #[must_use]
    pub fn status(&self) -> CompressionStatus {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    #[must_use]
    pub fn is_game_active(&self, game_id: i32) -> bool {
        let state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state
            .current
            .as_ref()
            .is_some_and(|job| job.game_id == game_id)
            || state.queued.iter().any(|job| job.game_id == game_id)
    }

    pub async fn queue_compression(
        &self,
        game_id: i32,
        format: &str,
    ) -> Result<(), CompressionError> {
        if format != "zip" && format != "tar" {
            return Err(CompressionError::InvalidFormat);
        }

        let game_model = game::Entity::find_by_id(game_id)
            .one(&self.db)
            .await?
            .ok_or(CompressionError::GameNotFound)?;
        if !file_browse::exists_on_disk(&game_model) {
            return Err(CompressionError::GameMissingOnDisk);
        }
        if file_browse::is_standalone_archive(&game_model) {
            return Err(CompressionError::StandaloneArchive);
        }
        if file_browse::find_single_archive(Path::new(&game_model.folder_path)).is_some() {
            return Err(CompressionError::SingleArchive);
        }
        if self.is_game_active(game_id) {
            return Err(CompressionError::AlreadyQueued);
        }

        let mut active_model: game::ActiveModel = game_model.clone().into();
        active_model.is_processing = Set(true);
        active_model.update(&self.db).await?;

        {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            state.queued.push(CompressionJobInfo {
                game_id,
                game_title: game_model.title.clone(),
                progress_percent: None,
                format: format.to_string(),
            });
        }

        self.sender
            .send(CompressionRequest {
                game_id,
                format: format.to_string(),
            })
            .map_err(|error| CompressionError::Packaging(error.to_string()))?;

        info!(game_id, format, title = %game_model.title, "queued compression job");
        Ok(())
    }

    pub async fn cancel_compression(&self, game_id: i32) -> Result<(), CompressionError> {
        let was_queued = {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let before = state.queued.len();
            state.queued.retain(|job| job.game_id != game_id);
            before != state.queued.len()
        };

        if was_queued {
            self.reset_processing_flag(game_id).await?;
            info!(game_id, "cancelled queued compression job");
            return Ok(());
        }

        if let Some(cancel_flag) = self.cancellations.get(&game_id) {
            cancel_flag.store(true, Ordering::Relaxed);
            info!(game_id, "cancelling active compression job");
        }

        Ok(())
    }

    pub async fn run_queue(self: Arc<Self>) {
        if let Err(error) = self.reset_all_processing_flags().await {
            error!(error = %error, "failed to reset processing flags");
        }

        let mut receiver = match self
            .receiver
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
        {
            Some(receiver) => receiver,
            None => return,
        };

        while let Some(request) = receiver.recv().await {
            if !self.is_game_active(request.game_id) {
                continue;
            }

            self.remove_from_queue(request.game_id);
            self.start_current_job(request.game_id, &request.format)
                .await;
            self.process_game(request).await;
            self.finish_current_job();
        }
    }

    async fn process_game(self: &Arc<Self>, request: CompressionRequest) {
        let game_model = match game::Entity::find_by_id(request.game_id)
            .one(&self.db)
            .await
        {
            Ok(Some(game_model)) => game_model,
            Ok(None) => {
                warn!(
                    game_id = request.game_id,
                    "skipping compression for missing game"
                );
                return;
            }
            Err(error) => {
                error!(game_id = request.game_id, error = %error, "failed to load compression job");
                return;
            }
        };

        let cancel_flag = Arc::new(AtomicBool::new(false));
        self.cancellations
            .insert(request.game_id, Arc::clone(&cancel_flag));

        let service = Arc::clone(self);
        let format = request.format.clone();
        let job_game = game_model.clone();
        let packaging_result = tokio::task::spawn_blocking(move || {
            package_game_in_place(&job_game, &format, &cancel_flag, move |progress_percent| {
                service.update_progress(request.game_id, progress_percent);
            })
        })
        .await;

        self.cancellations.remove(&request.game_id);

        match packaging_result {
            Ok(Ok(archive_size)) => {
                if let Err(error) = self.complete_job(game_model, archive_size).await {
                    error!(game_id = request.game_id, error = %error, "failed to complete compression job");
                } else {
                    info!(game_id = request.game_id, size_bytes = archive_size, format = %request.format, "compression complete");
                }
            }
            Ok(Err(PackagingError::Cancelled)) => {
                if let Err(error) = self.reset_processing_flag(request.game_id).await {
                    error!(game_id = request.game_id, error = %error, "failed to reset cancelled compression job");
                }
                info!(game_id = request.game_id, "compression cancelled");
            }
            Ok(Err(PackagingError::NoFiles)) => {
                if let Err(error) = self.reset_processing_flag(request.game_id).await {
                    error!(game_id = request.game_id, error = %error, "failed to reset empty compression job");
                }
                warn!(
                    game_id = request.game_id,
                    "no files found for compression job"
                );
            }
            Ok(Err(error)) => {
                if let Err(reset_error) = self.reset_processing_flag(request.game_id).await {
                    error!(game_id = request.game_id, error = %reset_error, "failed to reset failed compression job");
                }
                error!(game_id = request.game_id, error = %error, "compression failed");
            }
            Err(error) => {
                if let Err(reset_error) = self.reset_processing_flag(request.game_id).await {
                    error!(game_id = request.game_id, error = %reset_error, "failed to reset aborted compression job");
                }
                error!(game_id = request.game_id, error = %error, "compression worker panicked");
            }
        }
    }

    async fn complete_job(
        &self,
        game_model: game::Model,
        archive_size: i64,
    ) -> Result<(), CompressionError> {
        let mut active_model: game::ActiveModel = game_model.into();
        active_model.size_bytes = Set(archive_size);
        active_model.is_processing = Set(false);
        active_model.update(&self.db).await?;
        Ok(())
    }

    async fn reset_processing_flag(&self, game_id: i32) -> Result<(), CompressionError> {
        let Some(game_model) = game::Entity::find_by_id(game_id).one(&self.db).await? else {
            return Ok(());
        };

        let mut active_model: game::ActiveModel = game_model.into();
        active_model.is_processing = Set(false);
        active_model.update(&self.db).await?;
        Ok(())
    }

    async fn reset_all_processing_flags(&self) -> Result<(), CompressionError> {
        let stuck_games = game::Entity::find().all(&self.db).await?;
        for game_model in stuck_games
            .into_iter()
            .filter(|game_model| game_model.is_processing)
        {
            let mut active_model: game::ActiveModel = game_model.into();
            active_model.is_processing = Set(false);
            active_model.update(&self.db).await?;
        }
        Ok(())
    }

    fn remove_from_queue(&self, game_id: i32) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.queued.retain(|job| job.game_id != game_id);
    }

    async fn start_current_job(&self, game_id: i32, format: &str) {
        let title = game::Entity::find_by_id(game_id)
            .one(&self.db)
            .await
            .ok()
            .flatten()
            .map(|game_model| game_model.title)
            .unwrap_or_default();
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.current = Some(CompressionJobInfo {
            game_id,
            game_title: title,
            progress_percent: Some(0),
            format: format.to_string(),
        });
    }

    fn finish_current_job(&self) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.current = None;
    }

    fn update_progress(&self, game_id: i32, progress_percent: u8) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(current) = state
            .current
            .as_mut()
            .filter(|current| current.game_id == game_id)
        {
            current.progress_percent = Some(progress_percent);
        }
    }
}

fn package_game_in_place(
    game_model: &game::Model,
    format: &str,
    cancel_flag: &AtomicBool,
    update_progress: impl Fn(u8),
) -> Result<i64, PackagingError> {
    let root = Path::new(&game_model.folder_path);
    let all_files = collect_files(root)?;
    if all_files.is_empty() {
        return Err(PackagingError::NoFiles);
    }

    let extension = if format == "tar" { ".tar" } else { ".zip" };
    let temp_path = root.join(format!(
        ".claudio-compress-{}{}{extension}.tmp",
        game_model.id, ""
    ));
    if temp_path.exists() {
        fs::remove_file(&temp_path)?;
    }

    let total_bytes = all_files
        .iter()
        .map(|path| {
            fs::metadata(path)
                .map(|metadata| metadata.len())
                .unwrap_or_default()
        })
        .sum::<u64>();
    let mut bytes_processed = 0u64;

    let packaging_result = if format == "tar" {
        let file = fs::File::create(&temp_path)?;
        let mut builder = tar::Builder::new(file);
        for file_path in &all_files {
            ensure_not_cancelled(cancel_flag)?;
            let relative_path = relative_entry_name(root, file_path)?;
            builder.append_path_with_name(file_path, &relative_path)?;
            bytes_processed += fs::metadata(file_path)?.len();
            update_progress(progress(bytes_processed, total_bytes));
        }
        builder.finish()?;
        Ok(())
    } else {
        let file = fs::File::create(&temp_path)?;
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        let mut buffer = vec![0; 256 * 1024];

        for file_path in &all_files {
            ensure_not_cancelled(cancel_flag)?;
            let relative_path = relative_entry_name(root, file_path)?;
            writer.start_file(relative_path, options)?;

            let mut source = fs::File::open(file_path)?;
            loop {
                ensure_not_cancelled(cancel_flag)?;
                let read = source.read(&mut buffer)?;
                if read == 0 {
                    break;
                }
                writer.write_all(&buffer[..read])?;
                bytes_processed += read as u64;
                update_progress(progress(bytes_processed, total_bytes));
            }
        }

        writer.finish()?;
        Ok(())
    };

    if let Err(error) = packaging_result {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    ensure_not_cancelled(cancel_flag)?;
    clear_directory(root, &temp_path)?;

    let final_path = root.join(format!("{}{extension}", game_model.folder_name));
    if final_path.exists() {
        fs::remove_file(&final_path)?;
    }
    fs::rename(&temp_path, &final_path)?;

    let archive_size = fs::metadata(&final_path)?.len();
    Ok(archive_size as i64)
}

fn collect_files(root: &Path) -> Result<Vec<PathBuf>, PackagingError> {
    let mut files = Vec::new();
    let mut stack = vec![root.to_path_buf()];

    while let Some(path) = stack.pop() {
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let child = entry.path();
            if child.is_dir() {
                stack.push(child);
            } else if child.is_file() {
                files.push(child);
            }
        }
    }

    files.sort_unstable();
    Ok(files)
}

fn clear_directory(root: &Path, temp_path: &Path) -> Result<(), PackagingError> {
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        if path == temp_path {
            continue;
        }

        if path.is_dir() {
            fs::remove_dir_all(path)?;
        } else {
            fs::remove_file(path)?;
        }
    }

    Ok(())
}

fn relative_entry_name(root: &Path, path: &Path) -> Result<String, PackagingError> {
    path.strip_prefix(root)
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
        .map_err(|error| PackagingError::Io(std::io::Error::other(error.to_string())))
}

fn ensure_not_cancelled(cancel_flag: &AtomicBool) -> Result<(), PackagingError> {
    if cancel_flag.load(Ordering::Relaxed) {
        Err(PackagingError::Cancelled)
    } else {
        Ok(())
    }
}

fn progress(bytes_processed: u64, total_bytes: u64) -> u8 {
    if total_bytes == 0 {
        0
    } else {
        ((bytes_processed.saturating_mul(100) / total_bytes).min(100)) as u8
    }
}
