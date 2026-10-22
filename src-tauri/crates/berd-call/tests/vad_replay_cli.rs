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

#[test]
fn directory_conversion_preserves_audio_clock_revisions_and_generation_resets() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let write =
        |name: &str, value: Value| std::fs::write(root.join(name), value.to_string()).unwrap();
    write(
        "manifest.json",
        json!({"schema":"berd-call-capture/1","mic":{"sample_rate":48000},"session":{"stt_backend":"macos","continuous_recognition":true}}),
    );
    write(
        "labels.json",
        json!({"schema_version":1,"session_id":"directory","held_out":true,"labels":[{"start_sample":0,"end_sample":1536,"speech":true,"provenance":"human_checked"}]}),
    );
    write(
        "events.jsonl",
        json!({"us":9000000,"type":"clock","frame":2}),
    );
    let rows = [
        json!({"us":1000000,"type":"settings","revision":0,"settings":settings(0.5)}),
        json!({"us":2000000,"mic_sample":768,"vad_frame":0,"epoch":0,"generation":1,"mode":"listening","probability":0.6,"threshold":0.5,"detected":true,"active":true,"settings_revision":0}),
        json!({"us":3000000,"type":"settings","revision":1,"settings":settings(0.7)}),
        json!({"us":4000000,"mic_sample":1536,"vad_frame":1,"epoch":0,"generation":2,"mode":"listening","probability":0.6,"threshold":0.7,"detected":false,"active":false,"settings_revision":1}),
    ];
    let trace = rows
        .iter()
        .map(Value::to_string)
        .collect::<Vec<_>>()
        .join("\n");
    std::fs::write(root.join("vad.jsonl"), &trace).unwrap();
    let mut wav = hound::WavWriter::create(
        root.join("mic.wav"),
        hound::WavSpec {
            channels: 1,
            sample_rate: 48000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        },
    )
    .unwrap();
    for _ in 0..1536 {
        wav.write_sample(0_i16).unwrap();
    }
    wav.finalize().unwrap();
    let run = || {
        Command::new(env!("CARGO_BIN_EXE_berd-call"))
            .args(["vad-replay", "convert", root.to_str().unwrap()])
            .output()
            .unwrap()
    };
    let output = run();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let input: berd_call::vad_replay::ReplayInput = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(input.frames[0].end_ms, 16);
    assert_eq!(input.frames[1].end_ms, 32);
    assert_ne!(input.frames[0].epoch, input.frames[1].epoch);
    assert!(input.reply_waiting.is_empty());
    assert_eq!(
        berd_call::vad_replay::replay(&input, None)
            .unwrap()
            .scores
            .missed_speech_ms,
        16
    );
    assert_eq!(
        std::fs::read_to_string(root.join("vad.jsonl")).unwrap(),
        trace
    );
    for (key, value) in [
        ("active", json!(true)),
        ("vad_frame", json!(3)),
        ("mic_sample", json!(768)),
        ("threshold", json!(0.2)),
    ] {
        let mut bad = rows.clone();
        bad[3][key] = value;
        std::fs::write(
            root.join("vad.jsonl"),
            bad.iter()
                .map(Value::to_string)
                .collect::<Vec<_>>()
                .join("\n"),
        )
        .unwrap();
        let output = run();
        assert!(!output.status.success(), "accepted invalid {key}");
        assert!(output.stdout.is_empty());
    }
    let mut bad = rows.clone();
    bad[3]["settings_revision"] = json!(99);
    std::fs::write(
        root.join("vad.jsonl"),
        bad.iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n"),
    )
    .unwrap();
    let output = run();
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    std::fs::write(root.join("vad.jsonl"), &trace).unwrap();
    write(
        "events.jsonl",
        json!({"us":9000000,"type":"gap","reason":"capture_dropped"}),
    );
    assert!(!run().status.success());
    write(
        "events.jsonl",
        json!({"us":9000000,"type":"clock","frame":2}),
    );
    write(
        "manifest.json",
        json!({"schema":"berd-call-capture/1","mic":{"sample_rate":48000},"session":{"stt_backend":"parakeet","continuous_recognition":false}}),
    );
    assert!(!run().status.success());
}
