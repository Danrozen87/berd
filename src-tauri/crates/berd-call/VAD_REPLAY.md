# Offline VAD replay

Proposed integration, October 22, 2026. This command evaluates continuous-recognition activity gates. Capture-directory ingestion is being coordinated with the recording implementation; the current fixture entry point accepts normalized JSON.

Run `berd-call vad-replay INPUT.json --candidates CANDIDATES.json`. It emits JSONL, one report for the recorded settings followed by each named candidate, without opening a microphone or reading/writing live profiles. Candidate settings must be static. Recorded settings may include dynamic values because each frame records the values actually applied; replay does not simulate recognizer-driven learning.

Input has `schema_version: 1`, `session_id`, `held_out`, `frames`, `labels` and `reply_waiting`. Frames contain `end_ms`, `epoch`, `confidence`, `mode` (listening/interruption), and `settings` using the existing DetectionSettings schema. Each frame represents 16 ms. Epoch changes are explicit live gate resets; missing frame intervals leave state unknown until a full onset/release run determines it again.

Labels contain `start_ms`, `end_ms`, `speech` and `provenance` (human_checked/inferred). Label intervals must be ordered and nonoverlapping. Silence must be labeled explicitly; unlabelled audio is not assumed silent. Reply-waiting intervals contain start_ms/end_ms, also ordered and nonoverlapping. All times share the fixture's audio timeline. Candidate files contain an array of `{name, settings}`; names must be unique.

Scores report human-checked speech missed and false activity durations at 16 ms resolution, silent activity overlapping a waiting reply, onset-delay samples, missed/excluded utterances and fragmentation. Inferred labels are counted but excluded from correctness scores. Full onset samples require uninterrupted known detector coverage over the annotation. Interruption detection samples use the recorded playback mode at speech onset. They measure gate detection, not audible agent stopping. Raw samples allow tail analysis without hiding misses in an average.

These reports do not estimate a changed conversation's playback schedule. In particular, original reply-ready intervals and modes are fixed evidence. Replaying a stronger gate might change later playback in reality. Compare candidates on held-out sessions, inspect missed speech alongside latency, and trial improvements live before promoting them. No candidate is promoted by this command.

Each input file is capped at 128 MiB and a comparison at 64 candidates. Split long recordings into fixtures with preserved context and epoch boundaries. Raw recordings and fixtures stay local unless separately shared.
