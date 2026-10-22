//! Opt-in recording of a voice session for offline speech-detection replay.
//!
//! A capture directory holds `manifest.json`, `mic.wav` (every microphone frame the
//! session received, contiguous), `events.jsonl` (every protocol line in either
//! direction, with gaps and clock records) and `agent-<speech id>.sent.wav` for the
//! audio the session sent the host. Every record carries `us`, microseconds since
//! capture start, and `frame`, the number of microphone frames received so far.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use berd_call::input::{VoiceInputFrame, INPUT_FRAME_SAMPLES};
use serde::Serialize;
use serde_json::{json, Value};

use crate::session_audio::{AUDIO_BEGIN_KIND, AUDIO_CANCEL_KIND, AUDIO_CHUNK_KIND, AUDIO_END_KIND};

pub const SCHEMA: &str = "berd-call-capture/1";
const MIC_SAMPLE_RATE: u32 = 48_000;
/// All captures in a directory together keep at most this much; the oldest go first.
pub const LIMIT_BYTES: u64 = 10 << 30;
const QUEUE_RECORDS: usize = 1024;
/// Flush files and check the storage limit about once a second of microphone audio.
const FLUSH_FRAMES: u64 = 50;
/// Frames arrive every 20 ms; a longer silence means the host sent none.
const PAUSE_US: u64 = 100_000;
const FINISH_TIMEOUT: Duration = Duration::from_secs(2);

enum Record {
    Mic {
        us: u64,
        frame: u64,
        samples: Box<[f32; INPUT_FRAME_SAMPLES]>,
    },
    Line {
        us: u64,
        frame: u64,
        kind: &'static str,
        json: String,
    },
    Agent {
        us: u64,
        frame: u64,
        kind: u8,
        payload: Vec<u8>,
    },
    Finish(SyncSender<()>),
}

/// Records a session into a new directory; clones share it.
#[derive(Clone)]
pub struct Capture(Arc<Shared>);

struct Shared {
    start: Instant,
    frames: AtomicU64,
    dropped: Arc<AtomicU64>,
    sender: SyncSender<Record>,
    dir: PathBuf,
}

impl Capture {
    /// Creates `root/<UTC start>/` with `session` in its manifest, after deleting the
    /// oldest earlier captures in `root` that exceed the storage limit.
    pub fn start(root: &Path, session: Value) -> Result<Self, String> {
        Self::start_with_limit(root, session, LIMIT_BYTES)
    }

    fn start_with_limit(root: &Path, session: Value, limit: u64) -> Result<Self, String> {
        let fail = |error: &dyn std::fmt::Display| {
            format!("could not start capture in {}: {error}", root.display())
        };
        fs::create_dir_all(root).map_err(|error| fail(&error))?;
        let (start, now) = (
            Instant::now(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default(),
        );
        let name = utc_name(now.as_secs());
        let mut dir = root.join(&name);
        for attempt in 2.. {
            match fs::create_dir(&dir) {
                Ok(()) => break,
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                    dir = root.join(format!("{name}-{attempt}"))
                }
                Err(error) => return Err(fail(&error)),
            }
        }
        let manifest = json!({
            "schema": SCHEMA,
            "berd_call_version": env!("CARGO_PKG_VERSION"),
            "started_unix_ms": u64::try_from(now.as_millis()).unwrap_or(u64::MAX),
            "clock": "us is microseconds since capture start on one monotonic clock; frame is the number of mic.wav frames received before the record",
            "mic": {
                "file": "mic.wav",
                "sample_rate": MIC_SAMPLE_RATE,
                "frame_samples": INPUT_FRAME_SAMPLES,
                "source": "every frame the voice session received from the host, including frames it then ignored while muted; gap records mark pauses in what the host sent and frames the capture lost",
            },
            "agent": "agent-<speech id>.sent.wav is the audio the session sent the host; acknowledgements in events.jsonl are host-reported playback positions, estimates rather than measurements of audible output",
            "session": session,
        });
        fs::write(dir.join("manifest.json"), format!("{manifest:#}\n"))
            .map_err(|error| fail(&error))?;
        let dropped = Arc::new(AtomicU64::new(0));
        let mut writer =
            Writer::new(root, &dir, limit, Arc::clone(&dropped)).map_err(|error| fail(&error))?;
        let (sender, records) = mpsc::sync_channel(QUEUE_RECORDS);
        thread::Builder::new()
            .name("berd-call-capture".into())
            .spawn(move || writer.run(records))
            .map_err(|error| fail(&error))?;
        Ok(Self(Arc::new(Shared {
            start,
            frames: AtomicU64::new(0),
            dropped,
            sender,
            dir,
        })))
    }

    pub fn dir(&self) -> &Path {
        &self.0.dir
    }

    pub fn mic(&self, frame: &VoiceInputFrame) {
        let frame_index = self.0.frames.fetch_add(1, Ordering::Relaxed);
        self.send(Record::Mic {
            us: self.us(),
            frame: frame_index,
            samples: Box::new(*frame.as_samples()),
        });
    }

    /// A protocol message the session received.
    pub fn received(&self, message: &impl Serialize) {
        if let Ok(json) = serde_json::to_string(message) {
            self.line("in", json);
        }
    }

    /// A JSON line the session wrote to the host.
    pub fn sent(&self, json: &[u8]) {
        if let Ok(json) = std::str::from_utf8(json) {
            self.line("out", json.to_owned());
        }
    }

    /// A record the session wrote to the host's audio pipe.
    pub fn agent(&self, kind: u8, payload: &[u8]) {
        self.send(Record::Agent {
            us: self.us(),
            frame: self.frames(),
            kind,
            payload: payload.to_vec(),
        });
    }

    /// Writes everything queued and closes the files.
    pub fn finish(&self) {
        let (done, finished) = mpsc::sync_channel(1);
        if self.0.sender.send(Record::Finish(done)).is_ok() {
            let _ = finished.recv_timeout(FINISH_TIMEOUT);
        }
    }

    fn line(&self, kind: &'static str, json: String) {
        self.send(Record::Line {
            us: self.us(),
            frame: self.frames(),
            kind,
            json,
        });
    }

    fn send(&self, record: Record) {
        if self.0.sender.try_send(record).is_err() {
            self.0.dropped.fetch_add(1, Ordering::Relaxed);
        }
    }

    fn us(&self) -> u64 {
        u64::try_from(self.0.start.elapsed().as_micros()).unwrap_or(u64::MAX)
    }

    fn frames(&self) -> u64 {
        self.0.frames.load(Ordering::Relaxed)
    }
}

/// Mirrors complete lines written through it into the capture.
pub struct Tee<W> {
    inner: W,
    capture: Option<Capture>,
    line: Vec<u8>,
}

impl<W> Tee<W> {
    pub fn new(inner: W, capture: Option<Capture>) -> Self {
        Self {
            inner,
            capture,
            line: Vec::new(),
        }
    }
}

impl<W: Write> Write for Tee<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let written = self.inner.write(buf)?;
        if let Some(capture) = &self.capture {
            for &byte in &buf[..written] {
                if byte == b'\n' {
                    capture.sent(&self.line);
                    self.line.clear();
                } else {
                    self.line.push(byte);
                }
            }
        }
        Ok(written)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

type Wav = hound::WavWriter<BufWriter<File>>;
type Fallible<T> = Result<T, Box<dyn std::error::Error>>;

struct Writer {
    dir: PathBuf,
    /// Earlier captures in the same root, oldest first, with their sizes.
    earlier: Vec<(PathBuf, u64)>,
    limit: u64,
    bytes: u64,
    events: BufWriter<File>,
    mic: Option<Wav>,
    mic_frames: u64,
    last_mic_us: Option<u64>,
    agents: HashMap<u64, Wav>,
    /// Records the session could not queue because this writer fell behind.
    dropped: Arc<AtomicU64>,
}

impl Writer {
    fn new(root: &Path, dir: &Path, limit: u64, dropped: Arc<AtomicU64>) -> Fallible<Self> {
        let mut earlier = Vec::new();
        for entry in fs::read_dir(root)? {
            let path = entry?.path();
            if path != dir && is_capture(&path) {
                earlier.push((path.clone(), size(&path)));
            }
        }
        earlier.sort();
        let mut writer = Self {
            dir: dir.to_owned(),
            earlier,
            limit,
            bytes: 0,
            events: BufWriter::new(File::create(dir.join("events.jsonl"))?),
            mic: Some(wav(&dir.join("mic.wav"), MIC_SAMPLE_RATE)?),
            mic_frames: 0,
            last_mic_us: None,
            agents: HashMap::new(),
            dropped,
        };
        writer.prune()?;
        Ok(writer)
    }

    fn run(&mut self, records: Receiver<Record>) {
        while let Ok(record) = records.recv() {
            let result = match record {
                Record::Finish(done) => {
                    let _ = self.close();
                    let _ = done.send(());
                    return;
                }
                record => self.write(record),
            };
            if let Err(error) = result {
                eprintln!("berd-call: capture stopped: {error}");
                let _ = self.close();
                return;
            }
        }
        let _ = self.close();
    }

    fn write(&mut self, record: Record) -> Fallible<()> {
        let dropped = self.dropped.swap(0, Ordering::Relaxed);
        if dropped > 0 {
            let (us, frame) = (self.last_mic_us.unwrap_or_default(), self.mic_frames);
            self.event(
                us,
                frame,
                "gap",
                json!({"reason": "capture_dropped", "records": dropped}),
            )?;
        }
        match record {
            Record::Mic { us, frame, samples } => {
                if self
                    .last_mic_us
                    .is_some_and(|last| us.saturating_sub(last) > PAUSE_US)
                {
                    self.event(
                        us,
                        frame,
                        "gap",
                        json!({"reason": "input_paused", "since_us": self.last_mic_us}),
                    )?;
                }
                if frame > self.mic_frames {
                    self.event(us, frame, "gap", json!({"reason": "capture_dropped", "from_frame": self.mic_frames, "silence_written": self.mic.is_some()}))?;
                }
                self.last_mic_us = Some(us);
                if let Some(mic) = self.mic.as_mut() {
                    for _ in self.mic_frames..frame {
                        for _ in 0..INPUT_FRAME_SAMPLES {
                            mic.write_sample(0_i16)?;
                        }
                    }
                    for &sample in samples.iter() {
                        mic.write_sample(pcm16(sample))?;
                    }
                    self.bytes += (frame + 1 - self.mic_frames) * INPUT_FRAME_SAMPLES as u64 * 2;
                }
                self.mic_frames = frame + 1;
                if self.mic_frames.is_multiple_of(FLUSH_FRAMES) {
                    self.event(us, self.mic_frames, "clock", Value::Null)?;
                    self.flush()?;
                }
                Ok(())
            }
            Record::Line {
                us,
                frame,
                kind,
                json,
            } => {
                let line = format!(
                    "{{\"us\":{us},\"frame\":{frame},\"type\":\"{kind}\",\"message\":{json}}}\n"
                );
                self.bytes += line.len() as u64;
                Ok(self.events.write_all(line.as_bytes())?)
            }
            Record::Agent {
                us,
                frame,
                kind,
                payload,
            } => self.agent(us, frame, kind, &payload),
            Record::Finish(_) => unreachable!("finish is handled by run"),
        }
    }

    fn agent(&mut self, us: u64, frame: u64, kind: u8, payload: &[u8]) -> Fallible<()> {
        let word = |index: usize| {
            payload
                .get(index * 8..index * 8 + 8)
                .map(|bytes| u64::from_le_bytes(bytes.try_into().expect("eight bytes")))
                .unwrap_or_default()
        };
        let speech_id = word(0);
        match kind {
            AUDIO_BEGIN_KIND => {
                let sample_rate = payload
                    .get(8..12)
                    .map(|bytes| u32::from_le_bytes(bytes.try_into().expect("four bytes")))
                    .unwrap_or_default();
                let file = format!("agent-{speech_id}.sent.wav");
                if self.mic.is_some() && sample_rate > 0 {
                    self.agents
                        .insert(speech_id, wav(&self.dir.join(&file), sample_rate)?);
                }
                self.event(us, frame, "agent", json!({"record": "begin", "speech_id": speech_id, "sample_rate": sample_rate, "file": file}))
            }
            AUDIO_CHUNK_KIND => {
                let samples = payload.get(16..).unwrap_or_default().chunks_exact(4);
                let count = samples.len();
                if let Some(wav) = self.agents.get_mut(&speech_id) {
                    for sample in samples {
                        wav.write_sample(pcm16(f32::from_le_bytes(
                            sample.try_into().expect("four bytes"),
                        )))?;
                    }
                    self.bytes += count as u64 * 2;
                }
                self.event(us, frame, "agent", json!({"record": "chunk", "speech_id": speech_id, "sequence": word(1), "samples": count}))
            }
            AUDIO_END_KIND | AUDIO_CANCEL_KIND => {
                if let Some(wav) = self.agents.remove(&speech_id) {
                    wav.finalize()?;
                }
                let record = if kind == AUDIO_END_KIND {
                    "end"
                } else {
                    "cancel"
                };
                self.event(
                    us,
                    frame,
                    "agent",
                    json!({"record": record, "speech_id": speech_id}),
                )
            }
            _ => Ok(()),
        }
    }

    fn event(&mut self, us: u64, frame: u64, kind: &str, detail: Value) -> Fallible<()> {
        let mut record = json!({"us": us, "frame": frame, "type": kind});
        if let Value::Object(fields) = detail {
            record
                .as_object_mut()
                .expect("record is an object")
                .extend(fields);
        }
        let line = format!("{record}\n");
        self.bytes += line.len() as u64;
        Ok(self.events.write_all(line.as_bytes())?)
    }

    fn flush(&mut self) -> Fallible<()> {
        if let Some(mic) = self.mic.as_mut() {
            mic.flush()?;
        }
        for wav in self.agents.values_mut() {
            wav.flush()?;
        }
        self.events.flush()?;
        self.prune()
    }

    /// Deletes the oldest earlier captures while over the limit, then stops
    /// recording audio if this capture alone exceeds it.
    fn prune(&mut self) -> Fallible<()> {
        while self.bytes + self.earlier.iter().map(|(_, size)| size).sum::<u64>() > self.limit {
            if self.earlier.is_empty() {
                if let Some(mic) = self.mic.take() {
                    mic.finalize()?;
                    for (_, wav) in self.agents.drain() {
                        wav.finalize()?;
                    }
                    let (us, frame) = (self.last_mic_us.unwrap_or_default(), self.mic_frames);
                    self.event(us, frame, "limit", json!({"limit_bytes": self.limit}))?;
                }
                return Ok(());
            }
            let (path, _) = self.earlier.remove(0);
            fs::remove_dir_all(path)?;
        }
        Ok(())
    }

    fn close(&mut self) -> Fallible<()> {
        if let Some(mic) = self.mic.take() {
            mic.finalize()?;
        }
        for (_, wav) in self.agents.drain() {
            wav.finalize()?;
        }
        Ok(self.events.flush()?)
    }
}

fn wav(path: &Path, sample_rate: u32) -> Fallible<Wav> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    Ok(hound::WavWriter::create(path, spec)?)
}

fn pcm16(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * f32::from(i16::MAX)).round() as i16
}

/// Only directories this module created, so pruning never touches anything else.
fn is_capture(path: &Path) -> bool {
    fs::read_to_string(path.join("manifest.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|manifest| {
            manifest["schema"]
                .as_str()
                .map(|schema| schema.starts_with("berd-call-capture/"))
        })
        .unwrap_or(false)
}

fn size(path: &Path) -> u64 {
    fs::read_dir(path)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| match entry.metadata() {
            Ok(metadata) if metadata.is_dir() => size(&entry.path()),
            Ok(metadata) => metadata.len(),
            Err(_) => 0,
        })
        .sum()
}

/// `YYYY-MM-DDTHH-MM-SSZ`, which sorts chronologically and is safe in file names.
fn utc_name(unix_seconds: u64) -> String {
    let (days, seconds) = ((unix_seconds / 86_400) as i64, unix_seconds % 86_400);
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}-{:02}-{:02}Z",
        seconds / 3_600,
        seconds / 60 % 60,
        seconds % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(value: f32) -> VoiceInputFrame {
        VoiceInputFrame::try_from_samples(&[value; INPUT_FRAME_SAMPLES]).unwrap()
    }

    fn events(dir: &Path) -> Vec<Value> {
        fs::read_to_string(dir.join("events.jsonl"))
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    fn samples(path: &Path) -> Vec<i16> {
        hound::WavReader::open(path)
            .unwrap()
            .into_samples()
            .map(Result::unwrap)
            .collect()
    }

    #[test]
    fn names_captures_by_their_utc_start() {
        assert_eq!(utc_name(0), "1970-01-01T00-00-00Z");
        assert_eq!(utc_name(1_761_138_301), "2025-10-22T13-05-01Z");
        assert_eq!(utc_name(951_782_400), "2000-02-29T00-00-00Z");
    }

    #[test]
    fn records_mic_audio_protocol_lines_and_sent_agent_audio_on_one_timeline() {
        let root = tempfile::tempdir().unwrap();
        let capture = Capture::start(root.path(), json!({"stt_backend": "macos"})).unwrap();
        capture.mic(&frame(0.5));
        capture.received(&json!({"type": "prepare", "id": 1}));
        let mut tee = Tee::new(Vec::new(), Some(capture.clone()));
        tee.write_all(b"{\"type\":\"admitted\",").unwrap();
        tee.write_all(b"\"id\":1}\n").unwrap();
        capture.mic(&frame(-0.25));
        capture.agent(
            AUDIO_BEGIN_KIND,
            &[
                7_u64.to_le_bytes().as_slice(),
                &24_000_u32.to_le_bytes(),
                &1.0_f32.to_le_bytes(),
            ]
            .concat(),
        );
        let chunk: Vec<u8> = [7_u64, 0]
            .iter()
            .flat_map(|word| word.to_le_bytes())
            .chain([0.5_f32; 3].iter().flat_map(|sample| sample.to_le_bytes()))
            .collect();
        capture.agent(AUDIO_CHUNK_KIND, &chunk);
        capture.agent(
            AUDIO_END_KIND,
            &[7_u64, 0, 3]
                .iter()
                .flat_map(|word| word.to_le_bytes())
                .collect::<Vec<_>>(),
        );
        capture.finish();

        assert_eq!(tee.inner, b"{\"type\":\"admitted\",\"id\":1}\n");
        let dir = capture.dir();
        let manifest: Value =
            serde_json::from_str(&fs::read_to_string(dir.join("manifest.json")).unwrap()).unwrap();
        assert_eq!(manifest["schema"], SCHEMA);
        assert_eq!(manifest["session"]["stt_backend"], "macos");
        let mic = samples(&dir.join("mic.wav"));
        assert_eq!(mic.len(), 2 * INPUT_FRAME_SAMPLES);
        assert_eq!((mic[0], mic[INPUT_FRAME_SAMPLES]), (16_384, -8_192));
        assert_eq!(samples(&dir.join("agent-7.sent.wav")), [16_384; 3]);
        let events = events(dir);
        let shape: Vec<_> = events
            .iter()
            .map(|event| {
                (
                    event["type"].as_str().unwrap(),
                    event["frame"].as_u64().unwrap(),
                )
            })
            .collect();
        assert_eq!(
            shape,
            [
                ("in", 1),
                ("out", 1),
                ("agent", 2),
                ("agent", 2),
                ("agent", 2)
            ]
        );
        assert_eq!(events[0]["message"], json!({"type": "prepare", "id": 1}));
        assert_eq!(events[1]["message"], json!({"type": "admitted", "id": 1}));
        assert_eq!(events[2]["sample_rate"], 24_000);
        assert_eq!(events[3]["samples"], 3);
        assert_eq!(events[4]["record"], "end");
        assert!(events
            .windows(2)
            .all(|pair| pair[0]["us"].as_u64() <= pair[1]["us"].as_u64()));
    }

    #[test]
    fn marks_a_pause_in_received_frames_as_a_gap() {
        let root = tempfile::tempdir().unwrap();
        let capture = Capture::start(root.path(), Value::Null).unwrap();
        capture.mic(&frame(0.0));
        thread::sleep(Duration::from_micros(PAUSE_US + 20_000));
        capture.mic(&frame(0.0));
        capture.finish();

        let events = events(capture.dir());
        assert_eq!(events.len(), 1);
        assert_eq!(
            (
                events[0]["type"].as_str(),
                events[0]["reason"].as_str(),
                events[0]["frame"].as_u64()
            ),
            (Some("gap"), Some("input_paused"), Some(1))
        );
    }

    #[test]
    fn deletes_only_the_oldest_earlier_captures_beyond_the_limit() {
        let root = tempfile::tempdir().unwrap();
        for name in ["2026-01-01T00-00-00Z", "2026-01-02T00-00-00Z"] {
            let dir = root.path().join(name);
            fs::create_dir(&dir).unwrap();
            fs::write(
                dir.join("manifest.json"),
                json!({"schema": SCHEMA}).to_string(),
            )
            .unwrap();
            fs::write(dir.join("mic.wav"), vec![0; 4_000]).unwrap();
        }
        let unrelated = root.path().join("2025-12-31T00-00-00Z");
        fs::create_dir(&unrelated).unwrap();
        fs::write(unrelated.join("notes.txt"), vec![0; 4_000]).unwrap();

        let capture = Capture::start_with_limit(root.path(), Value::Null, 6_000).unwrap();
        capture.finish();

        assert!(!root.path().join("2026-01-01T00-00-00Z").exists());
        assert!(root.path().join("2026-01-02T00-00-00Z").exists());
        assert!(unrelated.exists());
    }

    #[test]
    fn stops_recording_audio_once_this_capture_alone_reaches_the_limit() {
        let root = tempfile::tempdir().unwrap();
        let limit = FLUSH_FRAMES * INPUT_FRAME_SAMPLES as u64;
        let capture = Capture::start_with_limit(root.path(), Value::Null, limit).unwrap();
        for _ in 0..2 * FLUSH_FRAMES {
            capture.mic(&frame(0.1));
        }
        capture.received(&json!({"type": "shutdown"}));
        capture.finish();

        assert_eq!(
            samples(&capture.dir().join("mic.wav")).len(),
            (FLUSH_FRAMES as usize) * INPUT_FRAME_SAMPLES
        );
        let kinds: Vec<_> = events(capture.dir())
            .iter()
            .map(|event| event["type"].as_str().unwrap().to_owned())
            .collect();
        assert_eq!(kinds, ["clock", "limit", "clock", "in"]);
    }
}
