#![cfg_attr(test, allow(dead_code))]

use crate::models::InstalledGame;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

const BIN_NONE: u8 = 0x00;
const BIN_STRING: u8 = 0x01;
const BIN_INT32: u8 = 0x02;
const BIN_POINTER: u8 = 0x04;
const BIN_COLOR: u8 = 0x06;
const BIN_END: u8 = 0x08;

#[derive(Debug, Clone, PartialEq)]
enum BinaryVdfValue {
    Object(BinaryVdfObject),
    String(String),
    Int32 { tag: u8, value: i32 },
}

type BinaryVdfObject = BTreeMap<String, BinaryVdfValue>;

pub(crate) fn write_steam_shortcut(
    installed: &InstalledGame,
    umu_run: &Path,
) -> Result<(), String> {
    let exe = installed
        .game_exe
        .as_deref()
        .ok_or_else(|| "No game executable is set.".to_string())?;
    let prefix = installed
        .wine_prefix
        .as_deref()
        .ok_or_else(|| "No Wine prefix is set.".to_string())?;
    let proton = installed.proton_path.as_deref().unwrap_or("UMU-Latest");
    write_steam_shortcut_command(
        installed,
        "\"/usr/bin/env\"".to_string(),
        format!(
            "WINEPREFIX={} PROTONPATH={} GAMEID=umu-default STORE=none {} {}",
            steam_quote(prefix),
            steam_quote(proton),
            steam_quote_path(umu_run),
            steam_quote(exe)
        ),
    )
}

pub(crate) fn write_steam_shortcut_command(
    installed: &InstalledGame,
    exe_command: String,
    launch_options: String,
) -> Result<(), String> {
    let shortcut_path = steam_shortcuts_path()
        .ok_or_else(|| "No Steam userdata folder was found for shortcut creation.".to_string())?;
    let exe = installed
        .game_exe
        .as_deref()
        .unwrap_or(installed.install_path.as_str());
    let start_dir = Path::new(exe)
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_string_lossy()
        .into_owned();
    let mut root = load_shortcuts(&shortcut_path)?;
    let shortcuts = ensure_object(&mut root, "shortcuts");
    let entry_key = shortcuts
        .iter()
        .find_map(|(key, value)| {
            shortcut_app_name(value)
                .is_some_and(|name| name == installed.title)
                .then(|| key.clone())
        })
        .unwrap_or_else(|| next_shortcut_key(shortcuts));
    let appid = shortcuts
        .get(&entry_key)
        .and_then(shortcut_appid)
        .unwrap_or_else(|| {
            entry_key
                .parse::<i32>()
                .unwrap_or_else(|_| next_appid(shortcuts))
        });

    let mut entry = BinaryVdfObject::new();
    insert_i32(&mut entry, "AllowDesktopConfig", 1);
    insert_i32(&mut entry, "AllowOverlay", 1);
    insert_string(&mut entry, "AppName", installed.title.clone());
    insert_i32(&mut entry, "Devkit", 0);
    insert_string(&mut entry, "DevkitGameID", String::new());
    insert_string(&mut entry, "Exe", exe_command);
    insert_string(&mut entry, "FlatpakAppID", String::new());
    insert_i32(&mut entry, "IsHidden", 0);
    insert_i32(&mut entry, "LastPlayTime", 0);
    insert_string(&mut entry, "LaunchOptions", launch_options);
    insert_i32(&mut entry, "OpenVR", 0);
    insert_string(&mut entry, "ShortcutPath", String::new());
    insert_string(&mut entry, "StartDir", start_dir);
    insert_i32(&mut entry, "appid", appid);
    insert_string(&mut entry, "icon", String::new());
    shortcuts.insert(entry_key, BinaryVdfValue::Object(entry));

    save_shortcuts(&shortcut_path, &root)
}

fn insert_string(object: &mut BinaryVdfObject, key: &str, value: String) {
    object.insert(key.to_string(), BinaryVdfValue::String(value));
}

fn insert_i32(object: &mut BinaryVdfObject, key: &str, value: i32) {
    object.insert(
        key.to_string(),
        BinaryVdfValue::Int32 {
            tag: BIN_INT32,
            value,
        },
    );
}

fn steam_shortcuts_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    [
        home.join(".steam").join("steam"),
        home.join(".var")
            .join("app")
            .join("com.valvesoftware.Steam")
            .join(".steam")
            .join("steam"),
    ]
    .into_iter()
    .filter_map(|steam_root| {
        let userdata = steam_root.join("userdata");
        let mut ids = fs::read_dir(&userdata)
            .ok()?
            .flatten()
            .filter_map(|entry| {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                (entry.path().is_dir() && name.chars().all(|ch| ch.is_ascii_digit()))
                    .then(|| name.into_owned())
            })
            .collect::<Vec<_>>();
        ids.sort();
        ids.into_iter()
            .next()
            .map(|id| userdata.join(id).join("config").join("shortcuts.vdf"))
    })
    .next()
}

fn load_shortcuts(path: &Path) -> Result<BinaryVdfObject, String> {
    if !path.exists() {
        return Ok(default_shortcuts());
    }
    let bytes = fs::read(path)
        .map_err(|err| format!("Failed to read Steam shortcuts {}: {err}", path.display()))?;
    if bytes.is_empty() {
        return Ok(default_shortcuts());
    }
    parse_binary_vdf(&bytes).map_err(|err| {
        format!(
            "Failed to parse Steam shortcuts {}. Leaving it unchanged: {err}",
            path.display()
        )
    })
}

fn save_shortcuts(path: &Path, root: &BinaryVdfObject) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            format!(
                "Failed to create Steam shortcut directory {}: {err}",
                parent.display()
            )
        })?;
    }
    if path.exists() {
        fs::copy(path, path.with_extension("vdf.claudio.bak")).map_err(|err| {
            format!(
                "Failed to back up Steam shortcuts {}: {err}",
                path.display()
            )
        })?;
    }
    let tmp_path = path.with_extension("vdf.claudio.tmp");
    fs::write(&tmp_path, dump_binary_vdf(root)).map_err(|err| {
        format!(
            "Failed to write temporary Steam shortcuts {}: {err}",
            tmp_path.display()
        )
    })?;
    fs::rename(&tmp_path, path).map_err(|err| {
        format!(
            "Failed to replace Steam shortcuts {}: {err}",
            path.display()
        )
    })
}

fn default_shortcuts() -> BinaryVdfObject {
    let mut root = BinaryVdfObject::new();
    root.insert(
        "shortcuts".to_string(),
        BinaryVdfValue::Object(BinaryVdfObject::new()),
    );
    root
}

fn ensure_object<'a>(root: &'a mut BinaryVdfObject, key: &str) -> &'a mut BinaryVdfObject {
    let value = root
        .entry(key.to_string())
        .or_insert_with(|| BinaryVdfValue::Object(BinaryVdfObject::new()));
    if !matches!(value, BinaryVdfValue::Object(_)) {
        *value = BinaryVdfValue::Object(BinaryVdfObject::new());
    }
    match value {
        BinaryVdfValue::Object(object) => object,
        _ => unreachable!(),
    }
}

fn shortcut_app_name(value: &BinaryVdfValue) -> Option<&str> {
    let BinaryVdfValue::Object(object) = value else {
        return None;
    };
    match object.get("AppName") {
        Some(BinaryVdfValue::String(name)) => Some(name),
        _ => None,
    }
}

fn shortcut_appid(value: &BinaryVdfValue) -> Option<i32> {
    let BinaryVdfValue::Object(object) = value else {
        return None;
    };
    match object.get("appid") {
        Some(BinaryVdfValue::Int32 { value, .. }) => Some(*value),
        _ => None,
    }
}

fn next_shortcut_key(shortcuts: &BinaryVdfObject) -> String {
    next_appid(shortcuts).to_string()
}

fn next_appid(shortcuts: &BinaryVdfObject) -> i32 {
    shortcuts
        .keys()
        .filter_map(|key| key.parse::<i32>().ok())
        .max()
        .unwrap_or(0)
        .saturating_add(1)
}

fn parse_binary_vdf(bytes: &[u8]) -> Result<BinaryVdfObject, String> {
    let mut cursor = Cursor { bytes, offset: 0 };
    cursor.read_object()
}

fn dump_binary_vdf(root: &BinaryVdfObject) -> Vec<u8> {
    let mut out = Vec::new();
    write_object(&mut out, root);
    out
}

struct Cursor<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl Cursor<'_> {
    fn read_object(&mut self) -> Result<BinaryVdfObject, String> {
        let mut object = BinaryVdfObject::new();
        loop {
            let ty = self.read_u8()?;
            if ty == BIN_END {
                break;
            }
            let key = self.read_cstring()?;
            let value = match ty {
                BIN_NONE => BinaryVdfValue::Object(self.read_object()?),
                BIN_STRING => BinaryVdfValue::String(self.read_cstring()?),
                BIN_INT32 | BIN_POINTER | BIN_COLOR => BinaryVdfValue::Int32 {
                    tag: ty,
                    value: self.read_i32()?,
                },
                other => return Err(format!("Unknown binary VDF type byte 0x{other:02x}")),
            };
            object.insert(key, value);
        }
        Ok(object)
    }

    fn read_u8(&mut self) -> Result<u8, String> {
        let value = *self
            .bytes
            .get(self.offset)
            .ok_or_else(|| "Unexpected end of binary VDF".to_string())?;
        self.offset += 1;
        Ok(value)
    }

    fn read_cstring(&mut self) -> Result<String, String> {
        let end = self.bytes[self.offset..]
            .iter()
            .position(|byte| *byte == 0)
            .ok_or_else(|| "Unterminated binary VDF string".to_string())?
            + self.offset;
        let value = String::from_utf8_lossy(&self.bytes[self.offset..end]).into_owned();
        self.offset = end + 1;
        Ok(value)
    }

    fn read_i32(&mut self) -> Result<i32, String> {
        let bytes = self.read_array::<4>()?;
        Ok(i32::from_le_bytes(bytes))
    }

    fn read_array<const N: usize>(&mut self) -> Result<[u8; N], String> {
        let end = self.offset + N;
        let slice = self
            .bytes
            .get(self.offset..end)
            .ok_or_else(|| "Unexpected end of binary VDF".to_string())?;
        self.offset = end;
        slice
            .try_into()
            .map_err(|_| "Unexpected binary VDF read size".to_string())
    }
}

fn write_object(out: &mut Vec<u8>, object: &BinaryVdfObject) {
    for (key, value) in object {
        write_value(out, key, value);
    }
    out.push(BIN_END);
}

fn write_value(out: &mut Vec<u8>, key: &str, value: &BinaryVdfValue) {
    match value {
        BinaryVdfValue::Object(object) => {
            out.push(BIN_NONE);
            write_cstring(out, key);
            for (child_key, child_value) in object {
                write_value(out, child_key, child_value);
            }
            out.push(BIN_END);
        }
        BinaryVdfValue::String(value) => {
            out.push(BIN_STRING);
            write_cstring(out, key);
            write_cstring(out, value);
        }
        BinaryVdfValue::Int32 { tag, value } => {
            out.push(*tag);
            write_cstring(out, key);
            out.extend_from_slice(&value.to_le_bytes());
        }
    }
}

fn write_cstring(out: &mut Vec<u8>, value: &str) {
    out.extend_from_slice(value.as_bytes());
    out.push(0);
}

fn steam_quote_path(path: &Path) -> String {
    steam_quote(path.to_string_lossy().as_ref())
}

fn steam_quote(value: &str) -> String {
    if value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '.' | '-' | '_' | ':'))
    {
        return value.to_string();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_vdf_round_trips_shortcut_fields() {
        let mut shortcut = BinaryVdfObject::new();
        shortcut.insert(
            "AppName".to_string(),
            BinaryVdfValue::String("A Game".to_string()),
        );
        shortcut.insert(
            "appid".to_string(),
            BinaryVdfValue::Int32 {
                tag: BIN_INT32,
                value: 42,
            },
        );
        let mut shortcuts = BinaryVdfObject::new();
        shortcuts.insert("42".to_string(), BinaryVdfValue::Object(shortcut));
        let mut root = BinaryVdfObject::new();
        root.insert("shortcuts".to_string(), BinaryVdfValue::Object(shortcuts));

        let parsed = parse_binary_vdf(&dump_binary_vdf(&root)).expect("vdf should parse");

        assert_eq!(parsed, root);
    }
}
