//! Experimental outcome-based tuning of independent local speech thresholds.
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Threshold {
    pub value: f32,
    #[serde(default)]
    pub dynamic: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct DetectionSettings {
    pub listening: Threshold,
    pub interruption: Threshold,
    #[serde(default)]
    pub timing: VadTiming,
    /// Maximum idle speech hold while recognition remains pending.
    #[serde(default = "default_pending_utterance_timeout_ms")]
    pub pending_utterance_timeout_ms: u32,
}

pub const fn default_pending_utterance_timeout_ms() -> u32 {
    5000
}

/// Apple recognition keeps receiving audio while these local activity gates settle.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct VadTiming {
    pub onset_ms: u32,
    pub release_ms: u32,
}

impl Default for VadTiming {
    fn default() -> Self {
        Self {
            onset_ms: 16,
            release_ms: 300,
        }
    }
}

#[derive(Default)]
pub struct SpeechGate {
    active: bool,
    speech_frames: u32,
    silence_frames: u32,
}

impl SpeechGate {
    pub fn observe(&mut self, detected: bool, timing: VadTiming) -> bool {
        if detected {
            self.silence_frames = 0;
            self.speech_frames = self.speech_frames.saturating_add(1);
            if self.speech_frames >= timing.onset_ms.div_ceil(16).max(1) {
                self.active = true;
            }
        } else {
            self.speech_frames = 0;
            self.silence_frames = self.silence_frames.saturating_add(1);
            if self.silence_frames >= timing.release_ms.div_ceil(16).max(1) {
                self.active = false;
            }
        }
        self.active
    }
}

pub fn is_detection_flag(flag: &str) -> bool {
    matches!(
        flag,
        "--pending-utterance-timeout-ms"
            | "--listening-threshold"
            | "--interruption-threshold"
            | "--dynamic-listening"
            | "--dynamic-interruption"
    )
}

pub fn without_detection_arguments(arguments: &[String]) -> Vec<String> {
    filter_arguments(arguments, false)
}

pub fn detection_arguments(arguments: &[String]) -> Vec<String> {
    filter_arguments(arguments, true)
}

fn filter_arguments(arguments: &[String], detection: bool) -> Vec<String> {
    let mut result = Vec::new();
    let mut index = 0;
    while index < arguments.len() {
        let flag = &arguments[index];
        let count = if flag == "session" || flag == "--allow-direct-agent-speech" {
            1
        } else {
            2
        };
        let end = (index + count).min(arguments.len());
        if is_detection_flag(flag) == detection {
            result.extend_from_slice(&arguments[index..end]);
        }
        index = end;
    }
    result
}

impl Default for DetectionSettings {
    fn default() -> Self {
        Self {
            timing: VadTiming::default(),
            pending_utterance_timeout_ms: default_pending_utterance_timeout_ms(),
            listening: Threshold {
                value: 0.5,
                dynamic: false,
            },
            interruption: Threshold {
                value: 0.65,
                dynamic: false,
            },
        }
    }
}

impl DetectionSettings {
    pub fn validate(self) -> Result<Self, String> {
        if !(16..=1000).contains(&self.timing.onset_ms)
            || !(16..=3000).contains(&self.timing.release_ms)
        {
            return Err("VAD onset must be 16 to 1000 ms and release 16 to 3000 ms".into());
        }
        if !(250..=30000).contains(&self.pending_utterance_timeout_ms) {
            return Err("pending utterance speech-hold timeout must be 250 to 30000 ms".into());
        }
        for threshold in [self.listening, self.interruption] {
            if !threshold.value.is_finite() || !(0.0..=1.0).contains(&threshold.value) {
                return Err("speech thresholds must be finite and between 0 and 1".into());
            }
            if threshold.dynamic && !(0.10..=0.95).contains(&threshold.value) {
                return Err("dynamic speech thresholds must start between 0.10 and 0.95".into());
            }
        }
        Ok(self)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
pub struct DetectionSnapshot {
    pub settings: DetectionSettings,
    pub adjustments: u64,
    pub no_result: u64,
    pub missed_detection: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DetectionMode {
    Listening,
    Interruption,
}

const STEP: f32 = 0.01;
const RESULT_GRACE: Duration = Duration::from_secs(5);

pub struct DetectionTuner {
    snapshot: DetectionSnapshot,
    window: Option<Observation>,
    grace_until: Option<Instant>,
}

struct Observation {
    mode: DetectionMode,
    began: Instant,
    detected: bool,
    ambiguous: bool,
}

impl DetectionTuner {
    pub fn new(settings: DetectionSettings) -> Self {
        Self {
            snapshot: DetectionSnapshot {
                settings,
                adjustments: 0,
                no_result: 0,
                missed_detection: 0,
            },
            window: None,
            grace_until: None,
        }
    }
    pub fn snapshot(&self) -> DetectionSnapshot {
        self.snapshot
    }
    pub fn observe(&mut self, mode: DetectionMode, detected: bool, now: Instant) {
        if self
            .window
            .as_ref()
            .is_some_and(|window| window.mode != mode && !window.detected)
        {
            self.window = None;
        }
        let window = self.window.get_or_insert(Observation {
            mode,
            began: now,
            detected: false,
            ambiguous: false,
        });
        window.ambiguous |= window.mode != mode;
        window.detected |= detected;
    }
    pub fn final_transcript(&mut self, now: Instant) {
        if let Some(window) = self.window.take().filter(|window| !window.ambiguous) {
            if !window.detected
                && now.duration_since(window.began) >= RESULT_GRACE
                && self.grace_until.is_none_or(|until| now >= until)
            {
                self.snapshot.missed_detection += 1;
                self.adjust(window.mode, false);
            }
        }
        self.grace_until = Some(now + RESULT_GRACE);
    }
    pub fn no_result(&mut self, _now: Instant) {
        if let Some(window) = self
            .window
            .take()
            .filter(|window| window.detected && !window.ambiguous)
        {
            self.snapshot.no_result += 1;
            self.adjust(window.mode, true);
        }
    }
    fn adjust(&mut self, mode: DetectionMode, increase: bool) {
        let threshold = match mode {
            DetectionMode::Listening => &mut self.snapshot.settings.listening,
            DetectionMode::Interruption => &mut self.snapshot.settings.interruption,
        };
        if !threshold.dynamic {
            return;
        }
        // Round to slider ticks, and never jump a manual value toward a bound.
        let next =
            ((threshold.value + if increase { STEP } else { -STEP }) * 100.0).round() / 100.0;
        if !(0.10..=0.95).contains(&next) {
            return;
        }
        threshold.value = next;
        self.snapshot.adjustments += 1;
    }
    pub fn reset_evidence(&mut self) {
        self.window = None;
        self.grace_until = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gate_requires_consecutive_onset_and_release_frames() {
        let mut gate = SpeechGate::default();
        let timing = VadTiming {
            onset_ms: 32,
            release_ms: 48,
        };
        assert!(!gate.observe(true, timing));
        assert!(!gate.observe(false, timing));
        assert!(!gate.observe(true, timing));
        assert!(gate.observe(true, timing));
        assert!(gate.observe(false, timing));
        assert!(gate.observe(false, timing));
        assert!(!gate.observe(false, timing));
    }

    #[test]
    fn legacy_profiles_get_default_timing_and_invalid_timing_is_rejected() {
        let settings: DetectionSettings =
            serde_json::from_str(r#"{"listening":{"value":0.5},"interruption":{"value":0.65}}"#)
                .unwrap();
        assert_eq!(settings.timing, VadTiming::default());
        assert_eq!(settings.pending_utterance_timeout_ms, 5000);
        for value in [0, 249, 30001, u32::MAX] {
            assert!(DetectionSettings {
                pending_utterance_timeout_ms: value,
                ..settings
            }
            .validate()
            .is_err());
        }
        for value in [250, 750, 30000] {
            let custom = DetectionSettings {
                pending_utterance_timeout_ms: value,
                ..settings
            }
            .validate()
            .unwrap();
            assert_eq!(
                serde_json::from_value::<DetectionSettings>(serde_json::to_value(custom).unwrap())
                    .unwrap(),
                custom
            );
        }
        for timing in [
            VadTiming {
                onset_ms: 0,
                release_ms: 300,
            },
            VadTiming {
                onset_ms: 16,
                release_ms: 3001,
            },
        ] {
            assert!(DetectionSettings { timing, ..settings }.validate().is_err());
        }
    }

    fn tuner() -> DetectionTuner {
        DetectionTuner::new(DetectionSettings {
            timing: VadTiming::default(),
            pending_utterance_timeout_ms: 5000,
            listening: Threshold {
                value: 0.5,
                dynamic: true,
            },
            interruption: Threshold {
                value: 0.65,
                dynamic: true,
            },
        })
    }
    #[test]
    fn detection_flags_do_not_consume_flag_shaped_hint_values() {
        let arguments = [
            "session",
            "--stt-hint",
            "--listening-threshold",
            "--language",
            "en-US",
            "--listening-threshold",
            "0.8",
            "--allow-direct-agent-speech",
        ]
        .map(str::to_string);
        assert_eq!(
            detection_arguments(&arguments),
            ["--listening-threshold", "0.8"]
        );
        assert_eq!(
            without_detection_arguments(&arguments),
            [
                "session",
                "--stt-hint",
                "--listening-threshold",
                "--language",
                "en-US",
                "--allow-direct-agent-speech"
            ]
        );
    }

    #[test]
    fn each_no_result_moves_only_the_detecting_mode_one_tick() {
        let mut tuner = tuner();
        let now = Instant::now();
        for n in 0..3 {
            let time = now + Duration::from_secs(n * 10);
            tuner.observe(DetectionMode::Listening, true, time);
            tuner.no_result(time + Duration::from_secs(6));
        }
        assert_eq!(tuner.snapshot().settings.listening.value, 0.53);
        assert_eq!(tuner.snapshot().settings.interruption.value, 0.65);
        assert_eq!(tuner.snapshot().adjustments, 3);
    }
    #[test]
    fn idle_mode_changes_do_not_disable_interruption_learning() {
        let mut tuner = tuner();
        let now = Instant::now();
        for n in 0..3 {
            let time = now + Duration::from_secs(n * 40);
            tuner.observe(DetectionMode::Listening, false, time);
            tuner.observe(
                DetectionMode::Interruption,
                true,
                time + Duration::from_secs(1),
            );
            tuner.no_result(time + Duration::from_secs(7));
        }
        assert_eq!(tuner.snapshot().settings.interruption.value, 0.68);
        assert_eq!(tuner.snapshot().settings.listening.value, 0.5);
    }

    #[test]
    fn manual_mode_never_learns() {
        let settings = DetectionSettings::default();
        let mut tuner = DetectionTuner::new(settings);
        let now = Instant::now();
        for n in 0..20 {
            let time = now + Duration::from_secs(n * 40);
            tuner.observe(DetectionMode::Interruption, true, time);
            tuner.no_result(time + Duration::from_secs(6));
        }
        assert_eq!(tuner.snapshot().settings, settings);
    }
    #[test]
    fn transcripts_without_detection_lower_only_the_observed_mode() {
        let mut tuner = tuner();
        let now = Instant::now();
        for n in 0..3 {
            let time = now + Duration::from_secs(n * 40);
            tuner.observe(DetectionMode::Interruption, false, time);
            tuner.final_transcript(time + Duration::from_secs(6));
        }
        assert_eq!(tuner.snapshot().settings.interruption.value, 0.62);
        assert_eq!(tuner.snapshot().settings.listening.value, 0.5);
    }
    #[test]
    fn adjustments_have_no_cooldown_and_stay_inside_dynamic_bounds() {
        let mut tuner = tuner();
        tuner.snapshot.settings.listening.value = 0.94;
        let now = Instant::now();
        for n in 0..100 {
            let time = now + Duration::from_secs(n * 7);
            tuner.observe(DetectionMode::Listening, true, time);
            tuner.no_result(time + Duration::from_secs(6));
        }
        assert_eq!(tuner.snapshot().settings.listening.value, 0.95);
        assert_eq!(tuner.snapshot().adjustments, 1);
        tuner.snapshot.settings.listening.value = 0.5;
        tuner.reset_evidence();
        for n in 0..6 {
            let time = now + Duration::from_secs(1000 + n);
            tuner.observe(DetectionMode::Listening, true, time);
            tuner.no_result(time);
        }
        assert_eq!(tuner.snapshot().adjustments, 7);
        assert_eq!(tuner.snapshot().settings.listening.value, 0.56);
    }

    #[test]
    fn recent_split_finals_and_detected_speech_do_not_lower_thresholds() {
        let mut tuner = tuner();
        let now = Instant::now();
        for n in 0..20 {
            let time = now + Duration::from_secs(n);
            tuner.observe(DetectionMode::Listening, n == 0, time);
            tuner.final_transcript(time);
        }
        assert_eq!(tuner.snapshot().adjustments, 0);
    }

    #[test]
    fn mode_switch_and_reset_discard_ambiguous_evidence() {
        let mut tuner = tuner();
        let now = Instant::now();
        for n in 0..10 {
            let time = now + Duration::from_secs(n * 40);
            tuner.observe(DetectionMode::Listening, true, time);
            tuner.observe(DetectionMode::Interruption, false, time);
            tuner.no_result(time + Duration::from_secs(6));
            tuner.observe(DetectionMode::Listening, true, time);
            tuner.reset_evidence();
            tuner.no_result(time + Duration::from_secs(6));
        }
        assert_eq!(tuner.snapshot().settings, self::tuner().snapshot().settings);
    }
}
