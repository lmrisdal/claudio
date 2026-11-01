use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Debug, PartialEq)]
pub(super) enum Incoming {
    Request {
        id: Value,
        method: String,
        params: Value,
    },
    Response {
        id: Value,
        result: Value,
    },
}

#[derive(Deserialize)]
struct RawMessage {
    id: Option<Value>,
    method: Option<String>,
    #[serde(default)]
    params: Value,
    #[serde(default)]
    result: Value,
}

pub(super) fn parse_line(line: &str) -> Result<Incoming, String> {
    let raw: RawMessage =
        serde_json::from_str(line).map_err(|error| format!("Malformed message: {error}"))?;
    let id = raw
        .id
        .ok_or_else(|| "Message is missing an id.".to_string())?;
    match raw.method {
        Some(method) => Ok(Incoming::Request {
            id,
            method,
            params: raw.params,
        }),
        None => Ok(Incoming::Response {
            id,
            result: raw.result,
        }),
    }
}

pub(super) fn result_line(id: &Value, result: &Value) -> String {
    json!({ "id": id, "result": result }).to_string()
}

pub(super) fn error_line(id: &Value, message: &str) -> String {
    json!({ "id": id, "error": message }).to_string()
}

pub(super) fn event_line(event: &str, payload: &Value) -> String {
    json!({ "event": event, "payload": payload }).to_string()
}

pub(super) fn confirm_request_line(id: &str, params: &Value) -> String {
    json!({ "id": id, "request": "confirm", "params": params }).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_requests_with_numeric_ids() {
        let parsed = parse_line(r#"{"id":1,"method":"ping","params":{"a":1}}"#);

        assert_eq!(
            parsed,
            Ok(Incoming::Request {
                id: json!(1),
                method: "ping".to_string(),
                params: json!({"a": 1}),
            })
        );
    }

    #[test]
    fn parses_confirm_responses_with_string_ids() {
        let parsed = parse_line(r#"{"id":"c1","result":true}"#);

        assert_eq!(
            parsed,
            Ok(Incoming::Response {
                id: json!("c1"),
                result: json!(true),
            })
        );
    }

    #[test]
    fn rejects_malformed_and_id_less_messages() {
        assert!(parse_line("not json").is_err());
        assert_eq!(
            parse_line(r#"{"method":"ping"}"#),
            Err("Message is missing an id.".to_string())
        );
    }

    fn parsed(line: &str) -> Value {
        serde_json::from_str(line).unwrap_or(Value::Null)
    }

    #[test]
    fn serializes_outgoing_lines_without_newlines() {
        let result = result_line(&json!(2), &json!({"ok": true}));
        let error = error_line(&json!(3), "boom");
        let event = event_line("install-progress", &json!({"gameId": 1}));

        assert_eq!(parsed(&result), json!({"id": 2, "result": {"ok": true}}));
        assert_eq!(parsed(&error), json!({"id": 3, "error": "boom"}));
        assert_eq!(
            parsed(&event),
            json!({"event": "install-progress", "payload": {"gameId": 1}})
        );
        assert!(
            ![result, error, event]
                .iter()
                .any(|line| line.contains('\n'))
        );
    }
}
