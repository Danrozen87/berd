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
