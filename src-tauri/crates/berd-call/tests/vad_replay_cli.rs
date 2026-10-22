use serde_json::{json, Value};
use std::process::Command;

fn settings(listening: f64) -> Value {
    json!({"listening":{"value":listening,"dynamic":false},"interruption":{"value":0.65,"dynamic":false},"timing":{"onset_ms":16,"release_ms":16}})
}

#[test]
fn real_cli_compares_profiles_and_preserves_input() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("input.json");
    let candidates = dir.path().join("candidates.json");
    let fixture = json!({
        "schema_version":1,"session_id":"held-out-test","held_out":true,
        "frames":[
            {"end_ms":16,"epoch":0,"confidence":0.6,"mode":"listening","settings":settings(0.5)},
            {"end_ms":32,"epoch":0,"confidence":0.0,"mode":"listening","settings":settings(0.5)}
        ],
        "labels":[{"start_ms":0,"end_ms":16,"speech":true,"provenance":"human_checked"},{"start_ms":16,"end_ms":32,"speech":false,"provenance":"human_checked"}],
        "reply_waiting":[{"start_ms":16,"end_ms":32}]
    }).to_string();
    std::fs::write(&input, &fixture).unwrap();
    std::fs::write(
        &candidates,
        json!([{"name":"higher","settings":settings(0.7)}]).to_string(),
    )
    .unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_berd-call"))
        .args([
            "vad-replay",
            input.to_str().unwrap(),
            "--candidates",
            candidates.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let reports: Vec<Value> = String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(reports.len(), 2);
    assert_eq!(reports[0]["scores"]["missed_speech_ms"], 0);
    assert_eq!(reports[1]["scores"]["missed_speech_ms"], 16);
    assert_eq!(
        reports[0]["scores"]["speech_onset"]["samples_ms"],
        json!([16])
    );
    assert_eq!(reports[1]["scores"]["speech_onset"]["missed"], 1);
    assert_eq!(std::fs::read_to_string(input).unwrap(), fixture);
}

#[test]
fn malformed_or_unsupported_input_fails_without_reports() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("invalid.json");
    std::fs::write(&input, r#"{"schema_version":99}"#).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_berd-call"))
        .args(["vad-replay", input.to_str().unwrap()])
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty());
}

#[test]
fn real_cli_reads_capture_events_and_reports_recognition_waiting() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("manifest.json"),
        r#"{"schema":"berd-call-capture/1"}"#,
    )
    .unwrap();
    let events = [
        json!({"us":0,"frame":0,"type":"out","message":{"type":"recognition_pending","active":true}}),
        json!({"us":10,"frame":0,"type":"in","message":{"type":"prepare_speak","id":1}}),
        json!({"us":50,"frame":0,"type":"out","message":{"type":"recognition_pending","active":false}}),
        json!({"us":60,"frame":0,"type":"out","message":{"type":"admitted","id":1}}),
    ];
    std::fs::write(
        dir.path().join("events.jsonl"),
        events
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n"),
    )
    .unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_berd-call"))
        .args(["vad-replay", "events", dir.path().to_str().unwrap()])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["request_wait_with_recognition_pending_us"], 40);
    assert_eq!(report["admitted_request_delays_us"], json!([50]));
}
