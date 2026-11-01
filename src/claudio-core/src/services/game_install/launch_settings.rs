use super::api::resolve_game_exe_path;
use super::*;

pub fn update_game_launch_settings(
    remote_game_id: i32,
    game_exe: Option<String>,
    proton_path: Option<String>,
    mut options: crate::models::GameLaunchOptions,
) -> Result<InstalledGame, String> {
    #[cfg(not(target_os = "windows"))]
    crate::services::launch_arguments::parse(&options.parameters)?;
    let mut game =
        registry::get(remote_game_id)?.ok_or_else(|| "Game is not installed.".to_string())?;
    game.game_exe = game_exe
        .filter(|exe| !exe.trim().is_empty())
        .map(|exe| resolve_game_exe_path(&game, &exe))
        .transpose()?;
    options.umu_game_id = options.umu_game_id.filter(|id| !id.trim().is_empty());
    game.proton_path = proton_path.filter(|path| !path.trim().is_empty());
    game.launch_options = options;
    registry::upsert(game)
}
