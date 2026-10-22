# Offline VAD replay

This command evaluates continuous-recognition activity gates from normalized JSON fixtures and measures observed waiting from call capture event logs.

Run `berd-call vad-replay INPUT.json --candidates CANDIDATES.json`. It emits JSONL, one report for the recorded settings followed by each named candidate, without opening a microphone or reading/writing live profiles. Candidate settings must be static. Recorded settings may include dynamic values because each frame records the values actually applied; replay does not simulate recognizer-driven learning.

Input has `schema_version: 1`, `session_id`, `held_out`, `frames`, `labels` and `reply_waiting`. Frames contain `end_ms`, `epoch`, `confidence`, `mode` (listening/interruption), and `settings` using the existing DetectionSettings schema. Each frame represents 16 ms. Epoch changes are explicit live gate resets; missing frame intervals leave state unknown until a full onset/release run determines it again.

Labels contain `start_ms`, `end_ms`, `speech` and `provenance` (human_checked/inferred). Label intervals must be ordered and nonoverlapping. Silence must be labeled explicitly; unlabelled audio is not assumed silent. Reply-waiting intervals contain start_ms/end_ms, also ordered and nonoverlapping. All times share the fixture's audio timeline. Candidate files contain an array of `{name, settings}`; names must be unique.

Scores report human-checked speech missed and false activity durations at 16 ms resolution, silent activity overlapping a waiting reply, onset-delay samples, missed/excluded utterances and fragmentation. Inferred labels are counted but excluded from correctness scores. Full onset samples require uninterrupted known detector coverage over the annotation. Interruption detection samples use the recorded playback mode at speech onset. They measure gate detection, not audible agent stopping. Raw samples allow tail analysis without hiding misses in an average.

These reports do not estimate a changed conversation's playback schedule. In particular, original reply-ready intervals and modes are fixed evidence. Replaying a stronger gate might change later playback in reality. Compare candidates on held-out sessions, inspect missed speech alongside latency, and trial improvements live before promoting them. No candidate is promoted by this command.

Each input file is capped at 128 MiB and a comparison at 64 candidates. Split long recordings into fixtures with preserved context and epoch boundaries. Raw recordings and fixtures stay local unless separately shared.

Run `berd-call vad-replay events CAPTURE_DIR` to analyze a `berd-call-capture/1` directory's `events.jsonl`. It measures the union of outstanding prepare-request intervals, their overlaps with VAD and pending recognition (reported separately and together), and admitted-request delay samples. Pending/not-admitted outcomes end a request interval without a successful admission sample. Gaps and capture limits censor outstanding requests; the interval immediately before a gap is excluded because its events may be missing. Requests left open at file end are reported unresolved. Logs must be ordered by monotonic microseconds; malformed/unknown-version input fails instead of producing a success score.

Request-wait overlap is observational. It includes preparation and other scheduling, so it is not proof of delay caused solely by VAD or recognition. The event analyzer uses the capture clock; normalized frame fixtures use the audio timeline. Converting the per-frame capture trace into candidate fixtures requires explicit sample/clock and epoch mapping. It must never infer timestamps by concatenating across muted/dropped input.

Pending recognition can hold replies after VAD clears. The Apple worker currently uses VAD end to start a five-second no-result deadline, then cancels and recreates recognition. Gate replay cannot prove transcript preservation under changed reset policies. Those trials require original audio, repeated recognition runs against the current-policy baseline, and omission/duplicate/late-result evaluation.

## Captured detector frames

Run `berd-call vad-replay convert CAPTURE_DIR > fixture.json`, then compare `fixture.json` with the usual replay command. Conversion reads `manifest.json`, `vad.jsonl`, `events.jsonl`, `mic.wav` and a companion `labels.json`. It never changes capture files or live profiles. Only macOS continuous recognition is supported. Missing settings, missing detector rows, inconsistent decisions, unsupported backends and explicit capture gaps/pauses/limits fail before emitting a fixture. Captures containing gaps need segmentation support before directory conversion can score them.

Create `labels.json` with an explicit session identity and held-out membership:

```json
{"schema_version":1,"session_id":"desk-2026-10-22","held_out":true,"labels":[{"start_sample":0,"end_sample":48000,"speech":true,"provenance":"human_checked"}]}
```

Label bounds are start-inclusive, end-exclusive indices in the mono 48 kHz `mic.wav`, aligned to whole milliseconds (48 samples). Do not mark inferred labels as human checked. Empty labels are allowed and produce unlabelled coverage rather than correctness scores. The converter checks trace and label bounds against the WAV header. It does not verify every audio sample or establish that the recording contains the original microphone signal.

Detector `mic_sample` is the end-exclusive source sample index. Conversion floors it to milliseconds, losing less than one millisecond of alignment precision. Processing `us` is validated separately and is never substituted for audio time. Effective settings revisions rebuild each frame; changes to either mute epoch or recognizer generation create a replay reset. For known gate states, recorded `active` must agree with the reconstructed baseline. Resampler history crossing resets remains part of the recorded probabilities.

Converted fixtures deliberately contain no `reply_waiting` intervals. Use `vad-replay events` for observed protocol waiting on the processing clock. Its intervals cannot be projected onto source samples without measuring input buffering and worker latency; a zero `silent_reply_held_ms` from a converted fixture therefore does not establish an absence of waiting. Counterfactual recognition-policy trials against original audio remain separate work.
