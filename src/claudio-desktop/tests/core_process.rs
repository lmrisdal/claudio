#![cfg(target_os = "linux")]

use serde_json::{Value, json};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

struct Core {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: BufReader<ChildStdout>,
    data_home: PathBuf,
}

fn unique_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "claudio-core-{name}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    fs::create_dir_all(&dir).expect("temp dir");
    dir
}

impl Core {
    fn start(name: &str) -> Self {
        let data_home = unique_dir(name);
        let mut child = Command::new(env!("CARGO_BIN_EXE_claudio-core"))
            .arg("--resource-dir")
            .arg(&data_home)
            .env("XDG_DATA_HOME", &data_home)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("claudio-core should start");
        let stdin = child.stdin.take();
        let stdout = BufReader::new(child.stdout.take().expect("stdout pipe"));
        Self {
            child,
            stdin,
            stdout,
            data_home,
        }
    }

    fn send(&mut self, message: Value) {
        let stdin = self.stdin.as_mut().expect("stdin open");
        writeln!(stdin, "{message}").expect("write request");
        stdin.flush().expect("flush request");
    }

    fn read_line(&mut self) -> String {
        let mut line = String::new();
        self.stdout.read_line(&mut line).expect("read stdout");
        line
    }

    fn call(&mut self, id: u64, method: &str, params: Value) -> Value {
        self.send(json!({"id": id, "method": method, "params": params}));
        loop {
            let line = self.read_line();
            let value: Value = serde_json::from_str(line.trim())
                .unwrap_or_else(|_| panic!("stdout line is not protocol JSON: {line:?}"));
            if value["id"] == json!(id) {
                return value;
            }
        }
    }

    fn close_stdin_and_wait(&mut self) -> bool {
        drop(self.stdin.take());
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        false
    }

    fn install_script_game(&self, id: i32, script: &str) -> PathBuf {
        let install_dir = self.data_home.join(format!("game-{id}"));
        fs::create_dir_all(&install_dir).expect("install dir");
        let exe = install_dir.join("run.sh");
        fs::write(&exe, script).expect("script");
        fs::set_permissions(&exe, fs::Permissions::from_mode(0o755)).expect("chmod");
        let registry = json!([{
            "remoteGameId": id,
            "title": "Script Game",
            "platform": "linux",
            "installType": "portable",
            "installPath": install_dir,
            "gameExe": exe,
            "installedAt": "1"
        }]);
        let data_dir = self.data_home.join("claudio");
        fs::create_dir_all(&data_dir).expect("data dir");
        fs::write(data_dir.join("installed-games.json"), registry.to_string()).expect("registry");
        install_dir
    }
}

impl Drop for Core {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = fs::remove_dir_all(&self.data_home);
    }
}

fn process_is_alive(pid: i32) -> bool {
    Path::new(&format!("/proc/{pid}")).exists()
}

fn wait_for_file(path: &Path) -> String {
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if let Ok(contents) = fs::read_to_string(path)
            && !contents.trim().is_empty()
        {
            return contents;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    panic!("{} was never written", path.display());
}

#[test]
fn stdout_stays_pure_protocol_when_a_launched_child_writes_to_stdout() {
    let mut core = Core::start("stdout");
    let install_dir = core.install_script_game(
        1,
        "#!/bin/sh\necho CORRUPTING-THE-PROTOCOL\necho CORRUPTING-STDERR >&2\necho $$ > pid\nexec sleep 30\n",
    );

    let launched = core.call(1, "launch_game", json!({"remoteGameId": 1}));
    let pid: i32 = wait_for_file(&install_dir.join("pid"))
        .trim()
        .parse()
        .expect("pid");
    let running = core.call(2, "list_running_games", Value::Null);
    let ping = core.call(3, "ping", Value::Null);

    assert!(launched.get("error").is_none(), "{launched}");
    assert_eq!(running["result"].as_array().map(Vec::len), Some(1));
    assert_eq!(ping["result"]["platform"], "linux");
    let _ = Command::new("kill").arg(pid.to_string()).status();
}

#[test]
fn core_exits_on_stdin_close_and_leaves_running_games_alive() {
    let mut core = Core::start("lifetime");
    let install_dir = core.install_script_game(2, "#!/bin/sh\necho $$ > pid\nexec sleep 30\n");
    let launched = core.call(1, "launch_game", json!({"remoteGameId": 2}));
    assert!(launched.get("error").is_none(), "{launched}");
    let pid: i32 = wait_for_file(&install_dir.join("pid"))
        .trim()
        .parse()
        .expect("pid");

    let exited = core.close_stdin_and_wait();

    assert!(exited, "core should exit when stdin closes");
    assert!(process_is_alive(pid), "game should outlive the core");
    let _ = Command::new("kill").arg(pid.to_string()).status();
}

#[test]
fn no_subprocess_inherits_the_protocol_stdout() {
    let sources = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut offenders = Vec::new();
    let mut pending = vec![sources];
    while let Some(dir) = pending.pop() {
        for entry in fs::read_dir(&dir).expect("read src").flatten() {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else if path.extension().is_some_and(|ext| ext == "rs")
                && fs::read_to_string(&path)
                    .unwrap_or_default()
                    .contains("Stdio::inherit")
            {
                offenders.push(path);
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "Stdio::inherit found in {offenders:?}"
    );
}
