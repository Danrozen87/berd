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
}

pub fn is_detection_flag(flag: &str) -> bool {
    matches!(
        flag,
        "--listening-threshold"
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
const COOLDOWN: Duration = Duration::from_secs(30);
const RESULT_GRACE: Duration = Duration::from_secs(5);

pub struct DetectionTuner {
    snapshot: DetectionSnapshot,
    window: Option<Observation>,
    grace_until: Option<Instant>,
    evidence: [Evidence; 2],
}

struct Observation {
    mode: DetectionMode,
    began: Instant,
    detected: bool,
    ambiguous: bool,
}

#[derive(Default)]
struct Evidence {
    no_result: u8,
    missed: u8,
    last_adjustment: Option<Instant>,
}

impl DetectionMode {
    fn index(self) -> usize {
        usize::from(self == Self::Interruption)
    }
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
            evidence: Default::default(),
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
            let evidence = &mut self.evidence[window.mode.index()];
            evidence.no_result = 0;
            if window.detected {
                evidence.missed = 0;
            } else if now.duration_since(window.began) >= RESULT_GRACE
                && self.grace_until.is_none_or(|until| now >= until)
            {
                self.snapshot.missed_detection += 1;
                evidence.missed = evidence.missed.saturating_add(1);
                self.adjust(window.mode, false, now);
            }
        }
        self.grace_until = Some(now + RESULT_GRACE);
    }
    pub fn no_result(&mut self, now: Instant) {
        if let Some(window) = self
            .window
            .take()
            .filter(|window| window.detected && !window.ambiguous)
        {
            self.snapshot.no_result += 1;
            let evidence = &mut self.evidence[window.mode.index()];
            evidence.missed = 0;
            evidence.no_result = evidence.no_result.saturating_add(1);
            self.adjust(window.mode, true, now);
        }
    }
    fn adjust(&mut self, mode: DetectionMode, increase: bool, now: Instant) {
        let evidence = &mut self.evidence[mode.index()];
        let count = if increase {
            evidence.no_result
        } else {
            evidence.missed
        };
        if count < 3
            || evidence
                .last_adjustment
                .is_some_and(|last| now.duration_since(last) < COOLDOWN)
        {
            return;
        }
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
        evidence.last_adjustment = Some(now);
        evidence.no_result = 0;
        evidence.missed = 0;
    }
    pub fn reset_evidence(&mut self) {
        self.window = None;
        self.grace_until = None;
        for evidence in &mut self.evidence {
            evidence.no_result = 0;
            evidence.missed = 0;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tuner() -> DetectionTuner {
        DetectionTuner::new(DetectionSettings {
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
    fn repeated_no_result_moves_only_the_detecting_mode_one_tick() {
        let mut tuner = tuner();
        let now = Instant::now();
        for n in 0..3 {
            let time = now + Duration::from_secs(n * 10);
            tuner.observe(DetectionMode::Listening, true, time);
            tuner.no_result(time + Duration::from_secs(6));
        }
        assert_eq!(tuner.snapshot().settings.listening.value, 0.51);
        assert_eq!(tuner.snapshot().settings.interruption.value, 0.65);
        assert_eq!(tuner.snapshot().adjustments, 1);
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
        assert_eq!(tuner.snapshot().settings.interruption.value, 0.66);
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
        assert_eq!(tuner.snapshot().settings.interruption.value, 0.64);
        assert_eq!(tuner.snapshot().settings.listening.value, 0.5);
    }
    #[test]
    fn adjustments_are_rate_limited_and_stay_inside_dynamic_bounds() {
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
        assert_eq!(tuner.snapshot().adjustments, 2);
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
