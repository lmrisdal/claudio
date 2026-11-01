use super::serve;
use crate::settings::{DesktopSettings, with_test_data_dir_async};
use serde_json::{Value, json};
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream, Lines, WriteHalf};

const UNREACHABLE_SERVER: &str = "http://10.255.255.1:81";

struct Session {
    to_core: WriteHalf<DuplexStream>,
    from_core: Lines<BufReader<tokio::io::ReadHalf<DuplexStream>>>,
    server: tokio::task::JoinHandle<()>,
}

impl Session {
    fn start() -> Self {
        let (shell_side, core_side) = tokio::io::duplex(1 << 20);
        let (core_read, core_write) = tokio::io::split(core_side);
        let (shell_read, shell_write) = tokio::io::split(shell_side);
        let server = tokio::spawn(serve(
            BufReader::new(core_read),
            core_write,
            PathBuf::from("/resources"),
        ));
        Self {
            to_core: shell_write,
            from_core: BufReader::new(shell_read).lines(),
            server,
        }
    }

    async fn send(&mut self, message: Value) {
        let line = format!("{message}\n");
        self.to_core
            .write_all(line.as_bytes())
            .await
            .expect("write to core");
    }

    async fn next(&mut self) -> Value {
        let line = tokio::time::timeout(Duration::from_secs(5), self.from_core.next_line())
            .await
            .expect("core should answer in time")
            .expect("read from core")
            .expect("core closed the pipe");
        serde_json::from_str(&line).expect("core output should be one JSON object per line")
    }

    async fn call(&mut self, id: u64, method: &str, params: Value) -> Value {
        self.send(json!({"id": id, "method": method, "params": params}))
            .await;
        loop {
            let message = self.next().await;
            if message["id"] == json!(id) {
                return message;
            }
        }
    }
}

fn unique_dir(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "claudio-rpc-{name}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ))
}

#[tokio::test]
async fn ping_returns_the_request_id_and_platform() {
    let mut session = Session::start();

    let response = session.call(1, "ping", Value::Null).await;

    assert_eq!(response["id"], 1);
    assert_eq!(response["result"]["platform"], std::env::consts::OS);
    assert!(response.get("error").is_none());
}

#[tokio::test]
async fn string_request_ids_are_echoed_back() {
    let mut session = Session::start();

    session
        .send(json!({"id": "abc", "method": "ping", "params": {}}))
        .await;

    assert_eq!(session.next().await["id"], "abc");
}

#[tokio::test]
async fn unknown_methods_report_an_error_string() {
    let mut session = Session::start();

    let response = session.call(1, "nope", Value::Null).await;

    assert_eq!(response["error"], "Command nope not found");
}

#[tokio::test]
async fn params_accept_the_camel_case_names_the_web_app_sends() {
    let mut session = Session::start();

    let response = session
        .call(1, "resolve_install_path", json!({"gameTitle": "Some Game"}))
        .await;

    let path = response["result"].as_str().unwrap_or_default();
    assert!(path.contains("Some Game"), "unexpected path {path}");
}

#[tokio::test]
async fn snake_case_and_missing_params_are_rejected_with_the_command_name() {
    let mut session = Session::start();

    let snake = session
        .call(1, "resolve_install_path", json!({"game_title": "x"}))
        .await;
    let missing = session
        .call(2, "uninstall_game", json!({"remoteGameId": 3}))
        .await;

    for response in [snake, missing] {
        let message = response["error"].as_str().unwrap_or_default();
        assert!(
            message.starts_with("invalid args for command `"),
            "{message}"
        );
    }
}

#[tokio::test]
async fn domain_errors_are_passed_through_verbatim() {
    let mut session = Session::start();

    let response = session
        .call(1, "cancel_install", json!({"gameId": 999}))
        .await;

    assert_eq!(response["error"], "No active install for this game.");
}

#[tokio::test]
async fn has_active_operations_is_false_when_idle() {
    let mut session = Session::start();

    let response = session.call(1, "has_active_operations", Value::Null).await;

    assert_eq!(response["result"], false);
}

#[tokio::test]
async fn settings_round_trip_through_get_and_update() {
    let dir = unique_dir("settings");
    with_test_data_dir_async(dir, || async {
        let mut session = Session::start();
        let defaults = session.call(1, "get_settings", Value::Null).await;
        let mut updated: DesktopSettings =
            serde_json::from_value(defaults["result"].clone()).expect("settings should parse");
        updated.server_url = Some("http://example.test".to_string());

        let saved = session
            .call(2, "update_settings", json!({"settings": updated}))
            .await;
        let reloaded = session.call(3, "get_settings", Value::Null).await;

        assert_eq!(saved["result"], Value::Null);
        assert_eq!(reloaded["result"]["serverUrl"], "http://example.test");
    })
    .await;
}

#[tokio::test]
async fn progress_events_precede_the_failed_install_response() {
    let dir = unique_dir("events");
    with_test_data_dir_async(dir, || async {
        let mut session = Session::start();
        let game =
            json!({"id": 5, "title": "Eventful", "platform": "windows", "installType": "portable"});
        session
            .send(json!({"id": 1, "method": "install_game", "params": {"game": game}}))
            .await;

        let mut statuses = Vec::new();
        let response = loop {
            let message = session.next().await;
            if message["event"] == "install-progress" {
                assert_eq!(message["payload"]["gameId"], 5);
                statuses.push(
                    message["payload"]["status"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                );
            } else if message["id"] == 1 {
                break message;
            }
        };

        assert_eq!(response["error"], "Desktop server URL is not configured.");
        assert_eq!(statuses.last().map(String::as_str), Some("failed"));
    })
    .await;
}

#[tokio::test]
async fn slow_requests_do_not_block_other_commands() {
    let dir = unique_dir("concurrency");
    with_test_data_dir_async(dir, || async {
        let mut session = Session::start();
        session
            .send(json!({"id": 1, "method": "desktop_check_server_connection",
                "params": {"serverUrl": UNREACHABLE_SERVER}}))
            .await;

        let cancel = session
            .call(2, "cancel_install", json!({"gameId": 1}))
            .await;

        assert_eq!(cancel["error"], "No active install for this game.");
    })
    .await;
}

#[tokio::test]
async fn core_exits_when_stdin_closes_even_with_requests_in_flight() {
    let dir = unique_dir("eof");
    with_test_data_dir_async(dir, || async {
        let mut session = Session::start();
        session
            .send(json!({"id": 1, "method": "desktop_check_server_connection",
                "params": {"serverUrl": UNREACHABLE_SERVER}}))
            .await;

        session.to_core.shutdown().await.expect("close stdin");

        tokio::time::timeout(Duration::from_secs(1), session.server)
            .await
            .expect("serve should return promptly on EOF")
            .expect("serve task should not panic");
    })
    .await;
}

#[tokio::test]
async fn malformed_lines_are_skipped_without_killing_the_session() {
    let mut session = Session::start();
    session
        .to_core
        .write_all(b"this is not json\n\n")
        .await
        .expect("write garbage");

    let response = session.call(1, "ping", Value::Null).await;

    assert_eq!(response["id"], 1);
}

#[tokio::test]
async fn log_command_accepts_any_level() {
    let mut session = Session::start();

    let response = session
        .call(
            1,
            "log",
            json!({"level": "warn", "message": "from the shell", "source": "main"}),
        )
        .await;

    assert_eq!(response["result"], Value::Null);
}
