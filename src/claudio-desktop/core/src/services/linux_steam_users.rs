use std::fs;
use std::path::{Path, PathBuf};

const STEAM_ID64_BASE: u64 = 76_561_197_960_265_728;

#[derive(Debug, Default, PartialEq)]
struct LoginUser {
    steam_id: u64,
    most_recent: bool,
    timestamp: u64,
}

pub(crate) fn steam_shortcuts_path(home: &Path) -> Option<PathBuf> {
    [
        home.join(".steam").join("steam"),
        home.join(".local").join("share").join("Steam"),
        home.join(".var")
            .join("app")
            .join("com.valvesoftware.Steam")
            .join(".steam")
            .join("steam"),
    ]
    .into_iter()
    .find_map(|steam_root| {
        let userdata = steam_root.join("userdata");
        let account = most_recent_account(&steam_root)
            .filter(|id| userdata.join(id).is_dir())
            .or_else(|| first_account_dir(&userdata))?;
        Some(userdata.join(account).join("config").join("shortcuts.vdf"))
    })
}

fn first_account_dir(userdata: &Path) -> Option<String> {
    let mut ids = fs::read_dir(userdata)
        .ok()?
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            (entry.path().is_dir()
                && !name.is_empty()
                && name != "0"
                && name.chars().all(|ch| ch.is_ascii_digit()))
            .then_some(name)
        })
        .collect::<Vec<_>>();
    ids.sort();
    ids.into_iter().next()
}

fn most_recent_account(steam_root: &Path) -> Option<String> {
    let text = fs::read_to_string(steam_root.join("config").join("loginusers.vdf")).ok()?;
    let user = parse_login_users(&text)
        .into_iter()
        .max_by_key(|user| (user.most_recent, user.timestamp))?;
    user.steam_id
        .checked_sub(STEAM_ID64_BASE)
        .filter(|id| *id > 0)
        .map(|id| id.to_string())
}

fn parse_login_users(text: &str) -> Vec<LoginUser> {
    let tokens = tokenize(text);
    let mut users = Vec::new();
    let mut depth = 0usize;
    let mut current: Option<LoginUser> = None;
    let mut index = 0;
    while index < tokens.len() {
        match tokens[index].as_str() {
            "{" => depth += 1,
            "}" => {
                if depth == 2
                    && let Some(user) = current.take()
                {
                    users.push(user);
                }
                depth = depth.saturating_sub(1);
            }
            key if depth == 1 && tokens.get(index + 1).is_some_and(|next| next == "{") => {
                current = key.parse::<u64>().ok().map(|steam_id| LoginUser {
                    steam_id,
                    ..LoginUser::default()
                });
            }
            key if depth == 2 => {
                if let (Some(user), Some(value)) = (current.as_mut(), tokens.get(index + 1)) {
                    if key.eq_ignore_ascii_case("MostRecent") {
                        user.most_recent = value == "1";
                    } else if key.eq_ignore_ascii_case("Timestamp") {
                        user.timestamp = value.parse().unwrap_or(0);
                    }
                }
                index += 1;
            }
            _ => {}
        }
        index += 1;
    }
    users
}

fn tokenize(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '{' | '}' => tokens.push(ch.to_string()),
            '"' => {
                let mut token = String::new();
                while let Some(next) = chars.next() {
                    match next {
                        '\\' => {
                            if let Some(escaped) = chars.next() {
                                token.push(escaped);
                            }
                        }
                        '"' => break,
                        other => token.push(other),
                    }
                }
                tokens.push(token);
            }
            '/' if chars.peek() == Some(&'/') => {
                for next in chars.by_ref() {
                    if next == '\n' {
                        break;
                    }
                }
            }
            _ => {}
        }
    }
    tokens
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOGIN_USERS: &str = r#""users"
{
	"76561197960265729"
	{
		"AccountName"		"older"
		"timestamp"		"100"
	}
	"76561198009896654"
	{
		"AccountName"		"newer"
		"timestamp"		"200"
	}
}
"#;

    fn temp_home(name: &str) -> PathBuf {
        let home =
            std::env::temp_dir().join(format!("claudio-steam-users-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        home
    }

    fn make_dirs(path: &Path) {
        if let Err(error) = fs::create_dir_all(path) {
            panic!("failed to create {}: {error}", path.display());
        }
    }

    #[test]
    fn login_users_prefer_most_recent_then_timestamp() {
        let users = parse_login_users(LOGIN_USERS);
        assert_eq!(users.len(), 2);
        assert_eq!(
            users
                .iter()
                .max_by_key(|user| (user.most_recent, user.timestamp)),
            Some(&LoginUser {
                steam_id: 76_561_198_009_896_654,
                most_recent: false,
                timestamp: 200,
            })
        );

        let marked = LOGIN_USERS.replace(
            "\"timestamp\"\t\t\"100\"",
            "\"timestamp\"\t\t\"100\"\n\t\t\"MostRecent\"\t\t\"1\"",
        );
        let users = parse_login_users(&marked);
        assert_eq!(
            users
                .iter()
                .max_by_key(|user| (user.most_recent, user.timestamp))
                .map(|user| user.steam_id),
            Some(76_561_197_960_265_729)
        );
    }

    #[test]
    fn shortcuts_path_uses_the_logged_in_account_not_folder_zero() {
        let home = temp_home("login");
        let steam_root = home.join(".steam").join("steam");
        make_dirs(&steam_root.join("userdata").join("0"));
        make_dirs(&steam_root.join("userdata").join("1"));
        make_dirs(&steam_root.join("userdata").join("49630926"));
        make_dirs(&steam_root.join("config"));
        if let Err(error) = fs::write(
            steam_root.join("config").join("loginusers.vdf"),
            LOGIN_USERS,
        ) {
            panic!("failed to write loginusers.vdf: {error}");
        }

        assert_eq!(
            steam_shortcuts_path(&home),
            Some(
                steam_root
                    .join("userdata")
                    .join("49630926")
                    .join("config")
                    .join("shortcuts.vdf")
            )
        );
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn shortcuts_path_skips_folder_zero_without_login_users() {
        let home = temp_home("fallback");
        let userdata = home
            .join(".local")
            .join("share")
            .join("Steam")
            .join("userdata");
        make_dirs(&userdata.join("0"));
        make_dirs(&userdata.join("1234"));

        assert_eq!(
            steam_shortcuts_path(&home),
            Some(userdata.join("1234").join("config").join("shortcuts.vdf"))
        );
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn shortcuts_path_is_none_when_only_folder_zero_exists() {
        let home = temp_home("zero");
        make_dirs(&home.join(".steam").join("steam").join("userdata").join("0"));

        assert_eq!(steam_shortcuts_path(&home), None);
        let _ = fs::remove_dir_all(&home);
    }
}
