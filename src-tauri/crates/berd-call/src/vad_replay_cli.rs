use berd_call::vad_replay::{replay, Candidate, ReplayInput};
use std::io::{Read, Write};
use std::path::Path;

const MAX_INPUT: u64 = 128 * 1024 * 1024;

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, String> {
    let file = std::fs::File::open(path).map_err(|error| format!("{}: {error}", path.display()))?;
    let mut bytes = Vec::new();
    file.take(MAX_INPUT + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_INPUT {
        return Err("replay input exceeds 128 MiB; split sessions into fixtures".into());
    }
    serde_json::from_slice(&bytes).map_err(|error| format!("{}: {error}", path.display()))
}

pub fn run(args: &[String]) -> Result<(), String> {
    if args.first().is_some_and(|value| value == "convert") {
        if args.len() != 2 {
            return Err("usage: berd-call vad-replay convert CAPTURE_DIR".into());
        }
        let root = Path::new(&args[1]);
        let manifest = read_json(&root.join("manifest.json"))?;
        let annotations = read_json(&root.join("labels.json"))?;
        let rows = read_jsonl(&root.join("vad.jsonl"))?;
        let events = read_jsonl(&root.join("events.jsonl"))?;
        let input = berd_call::capture_replay::convert(&manifest, &rows, &events, annotations)?;
        let wav =
            hound::WavReader::open(root.join("mic.wav")).map_err(|error| error.to_string())?;
        let spec = wav.spec();
        if spec.sample_rate != 48000
            || spec.channels != 1
            || spec.bits_per_sample != 16
            || spec.sample_format != hound::SampleFormat::Int
        {
            return Err("capture mic.wav must be mono 48 kHz PCM16".into());
        }
        let samples = u64::from(wav.duration());
        if rows
            .iter()
            .filter_map(|row| row["mic_sample"].as_u64())
            .any(|end| end > samples)
            || input.labels.iter().any(|label| label.end_ms > samples / 48)
        {
            return Err("trace or labels extend beyond mic.wav".into());
        }
        serde_json::to_writer(std::io::stdout().lock(), &input)
            .map_err(|error| error.to_string())?;
        println!();
        return Ok(());
    }

    if args.first().is_some_and(|value| value == "events") {
        if args.len() != 2 {
            return Err("usage: berd-call vad-replay events CAPTURE_DIR".into());
        }
        let root = Path::new(&args[1]);
        let manifest: serde_json::Value = read_json(&root.join("manifest.json"))?;
        if manifest["schema"] != "berd-call-capture/1" {
            return Err("unsupported capture schema".into());
        }
        let file =
            std::fs::File::open(root.join("events.jsonl")).map_err(|error| error.to_string())?;
        let mut bytes = String::new();
        file.take(MAX_INPUT + 1)
            .read_to_string(&mut bytes)
            .map_err(|error| error.to_string())?;
        if bytes.len() as u64 > MAX_INPUT {
            return Err("capture events exceed 128 MiB".into());
        }
        let events: Vec<serde_json::Value> = bytes
            .lines()
            .map(serde_json::from_str)
            .collect::<Result<_, _>>()
            .map_err(|error| error.to_string())?;
        let metrics = berd_call::capture_metrics::measure(&events)?;
        serde_json::to_writer(std::io::stdout().lock(), &metrics)
            .map_err(|error| error.to_string())?;
        println!();
        return Ok(());
    }
    if args.len() != 1 && !(args.len() == 3 && args[1] == "--candidates") {
        return Err("usage: berd-call vad-replay INPUT.json [--candidates CANDIDATES.json]".into());
    }
    let input: ReplayInput = read_json(Path::new(&args[0]))?;
    let candidates: Vec<Candidate> = if args.len() == 3 {
        read_json(Path::new(&args[2]))?
    } else {
        vec![]
    };
    if candidates.len() > 64 {
        return Err("at most 64 candidates per comparison".into());
    }
    let mut names = std::collections::HashSet::new();
    for candidate in &candidates {
        if candidate.name == "recorded" || !names.insert(&candidate.name) {
            return Err("candidate names must be unique and cannot be recorded".into());
        }
    }
    // Validate every candidate before emitting any report.
    input.validate()?;
    for candidate in &candidates {
        candidate.settings.validate()?;
        if candidate.name.trim().is_empty()
            || candidate.settings.listening.dynamic
            || candidate.settings.interruption.dynamic
        {
            return Err("candidates need unique names and static thresholds".into());
        }
    }
    let stdout = std::io::stdout();
    let mut output = std::io::BufWriter::new(stdout.lock());
    for candidate in std::iter::once(None).chain(candidates.iter().map(Some)) {
        let report = replay(&input, candidate)?;
        serde_json::to_writer(&mut output, &report).map_err(|error| error.to_string())?;
        output.write_all(b"\n").map_err(|error| error.to_string())?;
    }
    output.flush().map_err(|error| error.to_string())
}

fn read_jsonl(path: &Path) -> Result<Vec<serde_json::Value>, String> {
    let file = std::fs::File::open(path).map_err(|error| format!("{}: {error}", path.display()))?;
    let mut bytes = String::new();
    file.take(MAX_INPUT + 1)
        .read_to_string(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_INPUT {
        return Err("capture trace exceeds 128 MiB".into());
    }
    bytes
        .lines()
        .map(serde_json::from_str)
        .collect::<Result<_, _>>()
        .map_err(|error| format!("{}: {error}", path.display()))
}
