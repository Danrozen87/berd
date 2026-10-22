//! Conservative gate-only candidate selection. Acceptance authorizes a live trial,
//! never a claim about recognition, transcript preservation or audible playback.
use crate::detection::DetectionSettings;
use crate::vad_replay::{self, Candidate, Mode, Provenance, ReplayInput, Report, Scores};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub enum StartConstraint {
    CaptureStart,
    GateReset,
    Quiet { max_probability: f32, ms: u32 },
}
impl StartConstraint {
    fn permits(&self, settings: DetectionSettings) -> bool {
        match self {
            Self::CaptureStart | Self::GateReset => true,
            Self::Quiet {
                max_probability,
                ms,
            } => {
                settings.listening.value >= *max_probability
                    && settings.interruption.value >= *max_probability
                    && settings.timing.release_ms <= *ms
            }
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AcceptancePolicy {
    pub min_sessions_per_partition: usize,
    pub min_checked_speech_ms: u64,
    pub min_checked_silence_ms: u64,
}
impl Default for AcceptancePolicy {
    fn default() -> Self {
        Self {
            min_sessions_per_partition: 2,
            min_checked_speech_ms: 1000,
            min_checked_silence_ms: 1000,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct Comparison {
    pub baseline: Report,
    pub candidate: Report,
    pub preserves_checked_speech: bool,
}

#[derive(Debug, Serialize)]
pub struct Evaluation {
    pub baseline: DetectionSettings,
    pub policy: AcceptancePolicy,
    pub source_sessions: Vec<String>,
    pub starts: Vec<StartConstraint>,
    pub accepted: bool,
    pub selected: Option<Candidate>,
    pub comparisons: Vec<Comparison>,
    pub baselines: Vec<Report>,
    pub reasons: Vec<String>,
    pub candidates_tested: usize,
}

/// Search immediate static threshold neighbours only. Timing is unchanged because
/// gate replay cannot evaluate recognition resets or preservation of pending words.
pub fn candidates(baseline: DetectionSettings) -> Result<Vec<Candidate>, String> {
    baseline.validate()?;
    let mut result = Vec::new();
    for listening in [true, false] {
        for delta in [-0.05, 0.05] {
            let mut settings = baseline;
            settings.listening.dynamic = false;
            settings.interruption.dynamic = false;
            let value = if listening {
                &mut settings.listening.value
            } else {
                &mut settings.interruption.value
            };
            let changed = (*value + delta).clamp(0.05, 0.95);
            if changed == *value {
                continue;
            }
            *value = changed;
            result.push(Candidate {
                name: format!(
                    "{}-{changed:.3}",
                    if listening {
                        "listening"
                    } else {
                        "interruption"
                    }
                ),
                settings,
            });
        }
    }
    Ok(result)
}

fn losses(scores: &Scores) -> [u64; 8] {
    [
        scores.missed_speech_ms,
        scores.speech_onset.missed,
        scores.interruption_detection.missed,
        scores.speech_fragments,
        scores.false_activity_ms,
        scores.silent_reply_held_ms,
        scores
            .speech_onset
            .samples_ms
            .iter()
            .copied()
            .max()
            .unwrap_or(0),
        scores
            .interruption_detection
            .samples_ms
            .iter()
            .copied()
            .max()
            .unwrap_or(0),
    ]
}

fn no_regression(before: &Scores, after: &Scores) -> bool {
    before.human_checked_ms == after.human_checked_ms
        && before.speech_onset.excluded == after.speech_onset.excluded
        && before.interruption_detection.excluded == after.interruption_detection.excluded
        && after.uncertain_ms == 0
        && losses(before).iter().zip(losses(after)).all(|(b, a)| a <= *b)
        // Preserve every measured utterance, not merely the worst latency.
        && before.speech_onset.samples_ms.len() == after.speech_onset.samples_ms.len()
        && before.interruption_detection.samples_ms.len() == after.interruption_detection.samples_ms.len()
        && before.speech_onset.samples_ms.iter().zip(&after.speech_onset.samples_ms).all(|(b,a)| a <= b)
        && before.interruption_detection.samples_ms.iter().zip(&after.interruption_detection.samples_ms).all(|(b,a)| a <= b)
}

fn improvement(comparisons: &[Comparison], held_out: bool) -> u128 {
    comparisons
        .iter()
        .filter(|c| c.baseline.held_out == held_out)
        .map(|c| {
            losses(&c.baseline.scores)
                .iter()
                .zip(losses(&c.candidate.scores))
                .map(|(b, a)| u128::from(b.saturating_sub(a)))
                .sum::<u128>()
        })
        .sum()
}

fn compare(
    inputs: &[ReplayInput],
    baseline: &Candidate,
    candidate: &Candidate,
) -> Result<Vec<Comparison>, String> {
    inputs
        .iter()
        .map(|input| {
            let before = vad_replay::replay(input, Some(baseline))?;
            let after = vad_replay::replay(input, Some(candidate))?;
            let preserves_checked_speech =
                before.decisions.iter().zip(&after.decisions).all(|(b, a)| {
                    b.active != Some(true)
                        || a.active == Some(true)
                        || !input.labels.iter().any(|l| {
                            l.speech
                                && l.provenance == Provenance::HumanChecked
                                && l.start_ms < b.end_ms
                                && l.end_ms > b.end_ms.saturating_sub(vad_replay::FRAME_MS)
                        })
                });
            Ok(Comparison {
                baseline: before,
                candidate: after,
                preserves_checked_speech,
            })
        })
        .collect()
}

fn checked_duration(input: &ReplayInput, speech: bool, mode: Option<Mode>) -> u64 {
    input
        .frames
        .iter()
        .filter(|f| mode.is_none_or(|mode| mode == f.mode))
        .map(|f| {
            let start = f.end_ms.saturating_sub(vad_replay::FRAME_MS);
            input
                .labels
                .iter()
                .filter(|l| l.provenance == Provenance::HumanChecked && l.speech == speech)
                .map(|l| l.end_ms.min(f.end_ms).saturating_sub(l.start_ms.max(start)))
                .sum::<u64>()
        })
        .sum()
}

/// Partition membership must be assigned before optimization, using independent
/// recording sessions. Callers must also group inputs by device/profile identity.
/// Inferred annotations are retained in reports but never count as checked truth.
pub fn evaluate(
    inputs: &[ReplayInput],
    baseline: DetectionSettings,
    policy: &AcceptancePolicy,
) -> Result<Evaluation, String> {
    let sources: Vec<_> = inputs.iter().map(|i| i.session_id.clone()).collect();
    evaluate_grouped(
        inputs,
        &sources,
        &vec![StartConstraint::CaptureStart; inputs.len()],
        baseline,
        policy,
    )
}

/// Use immutable source recording IDs for extracted clips. Each source must
/// belong to exactly one partition; clips do not count as independent sessions.
pub fn evaluate_grouped(
    inputs: &[ReplayInput],
    source_sessions: &[String],
    starts: &[StartConstraint],
    baseline: DetectionSettings,
    policy: &AcceptancePolicy,
) -> Result<Evaluation, String> {
    if inputs.len() != source_sessions.len() || source_sessions.iter().any(|s| s.trim().is_empty())
    {
        return Err("each replay needs a nonempty source recording identity".into());
    }
    if starts.len() != inputs.len()
        || starts.iter().any(|s| {
            matches!(s,
        StartConstraint::Quiet { max_probability, ms } if !max_probability.is_finite()
            || !(0.0..=1.0).contains(max_probability) || *ms == 0)
        })
    {
        return Err("each replay needs a valid initial gate constraint".into());
    }
    baseline.validate()?;
    if policy.min_sessions_per_partition == 0
        || policy.min_checked_speech_ms == 0
        || policy.min_checked_silence_ms == 0
    {
        return Err(
            "acceptance policy requires nonzero independent sessions and checked speech/silence"
                .into(),
        );
    }
    let mut output = Evaluation {
        baseline,
        policy: policy.clone(),
        source_sessions: source_sessions.to_vec(),
        starts: starts.to_vec(),
        accepted: false,
        selected: None,
        comparisons: Vec::new(),
        baselines: Vec::new(),
        reasons: Vec::new(),
        candidates_tested: 0,
    };
    let mut sessions = BTreeSet::new();
    let mut static_baseline = baseline;
    static_baseline.listening.dynamic = false;
    static_baseline.interruption.dynamic = false;
    let reference = Candidate {
        name: "baseline".into(),
        settings: static_baseline,
    };
    if starts.iter().any(|s| !s.permits(static_baseline)) {
        output
            .reasons
            .push("baseline violates a fixture initial gate constraint".into());
    }
    let mut partitions = BTreeMap::new();
    for (input, source) in inputs.iter().zip(source_sessions) {
        if partitions
            .insert(source, input.held_out)
            .is_some_and(|prior| prior != input.held_out)
        {
            output
                .reasons
                .push("source recording appears in both partitions".into());
        }
        input.validate()?;
        if !sessions.insert(&input.session_id) {
            output
                .reasons
                .push("duplicate recording session identity".into());
        }
        let report = vad_replay::replay(input, Some(&reference))?;
        if report.scores.gap_ms > 0
            || report.scores.uncertain_ms > 0
            || report.scores.speech_onset.excluded > 0
        {
            output.reasons.push(format!(
                "{} has incomplete detector evidence",
                input.session_id
            ));
        }
        output.baselines.push(report);
    }
    for held_out in [false, true] {
        let partition: Vec<_> = inputs.iter().filter(|i| i.held_out == held_out).collect();
        if inputs
            .iter()
            .zip(source_sessions)
            .filter(|(i, _)| {
                i.held_out == held_out
                    && checked_duration(i, true, None) > 0
                    && checked_duration(i, false, None) > 0
            })
            .map(|(_, s)| s)
            .collect::<BTreeSet<_>>()
            .len()
            < policy.min_sessions_per_partition
            || partition
                .iter()
                .map(|i| checked_duration(i, true, None))
                .sum::<u64>()
                < policy.min_checked_speech_ms
            || partition
                .iter()
                .map(|i| checked_duration(i, false, None))
                .sum::<u64>()
                < policy.min_checked_silence_ms
        {
            output.reasons.push(format!(
                "insufficient checked evidence in {} partition",
                if held_out { "held-out" } else { "training" }
            ));
        }
    }
    if !output.reasons.is_empty() {
        return Ok(output);
    }
    // Held-out scores are deliberately unavailable during candidate selection.
    let training: Vec<_> = inputs.iter().filter(|i| !i.held_out).cloned().collect();
    let mut best = 0;
    for candidate in candidates(static_baseline)? {
        if starts.iter().any(|s| !s.permits(candidate.settings)) {
            continue;
        }
        let mode = if candidate.settings.listening != static_baseline.listening {
            Mode::Listening
        } else {
            Mode::Interruption
        };
        // A threshold cannot be trialled without checked speech and silence in
        // that mode in BOTH partitions, even if overall counts are sufficient.
        if [false, true].iter().any(|held| {
            [true, false].iter().any(|speech| {
                inputs
                    .iter()
                    .filter(|i| i.held_out == *held)
                    .map(|i| checked_duration(i, *speech, Some(mode)))
                    .sum::<u64>()
                    < if *speech {
                        policy.min_checked_speech_ms
                    } else {
                        policy.min_checked_silence_ms
                    }
            })
        }) {
            continue;
        }
        output.candidates_tested += 1;
        let comparisons = compare(&training, &reference, &candidate)?;
        let gain = improvement(&comparisons, false);
        if gain > best
            && comparisons.iter().all(|c| {
                c.preserves_checked_speech && no_regression(&c.baseline.scores, &c.candidate.scores)
            })
        {
            best = gain;
            output.selected = Some(candidate);
        }
    }
    let Some(selected) = &output.selected else {
        output
            .reasons
            .push("no training candidate improved without regression".into());
        return Ok(output);
    };
    output.comparisons = compare(inputs, &reference, selected)?;
    if output.comparisons.iter().any(|c| {
        !c.preserves_checked_speech || !no_regression(&c.baseline.scores, &c.candidate.scores)
    }) {
        output
            .reasons
            .push("selected candidate regressed on independent evaluation".into());
    }
    if improvement(&output.comparisons, true) == 0 {
        output
            .reasons
            .push("selected candidate did not improve held-out evidence".into());
    }
    output.accepted = output.reasons.is_empty();
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vad_replay::{Frame, Label};
    fn baseline() -> DetectionSettings {
        let mut settings = DetectionSettings::default();
        settings.listening.value = 0.5;
        settings.interruption.value = 0.5;
        settings.timing.onset_ms = 16;
        settings.timing.release_ms = 16;
        settings
    }
    fn fixture(id: &str, held_out: bool, silence_confidence: f32) -> ReplayInput {
        let settings = baseline();
        ReplayInput {
            schema_version: 1,
            session_id: id.into(),
            held_out,
            frames: (1..=200)
                .map(|n| Frame {
                    end_ms: n * 16,
                    epoch: 0,
                    confidence: if n <= 100 { 0.9 } else { silence_confidence },
                    mode: Mode::Listening,
                    settings,
                })
                .collect(),
            labels: vec![
                Label {
                    start_ms: 0,
                    end_ms: 1600,
                    speech: true,
                    provenance: Provenance::HumanChecked,
                },
                Label {
                    start_ms: 1600,
                    end_ms: 3200,
                    speech: false,
                    provenance: Provenance::HumanChecked,
                },
            ],
            reply_waiting: vec![],
        }
    }
    fn corpus() -> Vec<ReplayInput> {
        vec![
            fixture("train1", false, 0.52),
            fixture("train2", false, 0.52),
            fixture("test1", true, 0.52),
            fixture("test2", true, 0.52),
        ]
    }
    #[test]
    fn checked_improvement_is_eligible_with_exact_evidence() {
        let evaluation = evaluate(&corpus(), baseline(), &AcceptancePolicy::default()).unwrap();
        assert!(evaluation.accepted, "{:?}", evaluation.reasons);
        let selected = evaluation.selected.as_ref().unwrap();
        assert_eq!(selected.settings.listening.value, 0.55);
        assert_eq!(selected.settings.timing, baseline().timing);
        assert_eq!(evaluation.comparisons.len(), 4);
        assert!(serde_json::to_value(evaluation).unwrap()["accepted"]
            .as_bool()
            .unwrap());
    }
    #[test]
    fn held_out_loss_rejects_without_searching_another_candidate() {
        let mut inputs = corpus();
        // Raising the threshold suppresses checked quiet held-out speech.
        for input in &mut inputs[2..] {
            for frame in &mut input.frames[..100] {
                frame.confidence = 0.52;
            }
        }
        let evaluation = evaluate(&inputs, baseline(), &AcceptancePolicy::default()).unwrap();
        assert!(!evaluation.accepted);
        assert_eq!(evaluation.selected.unwrap().settings.listening.value, 0.55);
        assert!(evaluation.reasons.iter().any(|r| r.contains("regressed")));
    }
    #[test]
    fn inferred_labels_cannot_authorize_a_trial() {
        let mut inputs = corpus();
        for input in &mut inputs {
            for label in &mut input.labels {
                label.provenance = Provenance::Inferred;
            }
        }
        let evaluation = evaluate(&inputs, baseline(), &AcceptancePolicy::default()).unwrap();
        assert!(!evaluation.accepted);
        assert!(evaluation.selected.is_none());
    }
    #[test]
    fn gaps_duplicates_and_missing_partition_fail_closed() {
        let mut inputs = corpus();
        inputs[0].frames.remove(50);
        assert!(
            !evaluate(&inputs, baseline(), &AcceptancePolicy::default())
                .unwrap()
                .accepted
        );
        let mut inputs = corpus();
        inputs[1].session_id = inputs[0].session_id.clone();
        assert!(
            !evaluate(&inputs, baseline(), &AcceptancePolicy::default())
                .unwrap()
                .accepted
        );
        assert!(
            !evaluate(&corpus()[..2], baseline(), &AcceptancePolicy::default())
                .unwrap()
                .accepted
        );
    }
    #[test]
    fn clips_cannot_inflate_session_count_or_leak_across_partitions() {
        let inputs = corpus();
        let same_source = vec!["capture".into(); 4];
        let result = evaluate_grouped(
            &inputs,
            &same_source,
            &vec![StartConstraint::CaptureStart; inputs.len()],
            baseline(),
            &AcceptancePolicy::default(),
        )
        .unwrap();
        assert!(!result.accepted);
        assert!(result.reasons.iter().any(|r| r.contains("both partitions")));
        let two_sources = vec!["train".into(), "train".into(), "test".into(), "test".into()];
        let result = evaluate_grouped(
            &inputs,
            &two_sources,
            &vec![StartConstraint::CaptureStart; inputs.len()],
            baseline(),
            &AcceptancePolicy::default(),
        )
        .unwrap();
        assert!(!result.accepted);
        assert!(result.reasons.iter().any(|r| r.contains("insufficient")));
    }
    #[test]
    fn no_improvement_and_zero_policy_are_rejected() {
        let inputs: Vec<_> = corpus()
            .into_iter()
            .map(|mut i| {
                for f in &mut i.frames[100..] {
                    f.confidence = 0.1;
                }
                i
            })
            .collect();
        assert!(
            !evaluate(&inputs, baseline(), &AcceptancePolicy::default())
                .unwrap()
                .accepted
        );
        let policy = AcceptancePolicy {
            min_sessions_per_partition: 0,
            ..Default::default()
        };
        assert!(evaluate(&inputs, baseline(), &policy).is_err());
    }
    #[test]
    fn candidate_bounds_preserve_timing_and_untuned_coordinate() {
        let settings = baseline();
        for c in candidates(settings).unwrap() {
            assert_eq!(c.settings.timing, settings.timing);
            assert!(!c.settings.listening.dynamic && !c.settings.interruption.dynamic);
            assert!((c.settings.listening.value - settings.listening.value).abs() <= 0.050001);
            assert!(
                (c.settings.interruption.value - settings.interruption.value).abs() <= 0.050001
            );
        }
    }
    #[test]
    fn quiet_start_bounds_are_inclusive_and_exclude_invalid_candidates() {
        let inputs = corpus();
        let sources: Vec<_> = inputs.iter().map(|i| i.session_id.clone()).collect();
        let starts = vec![
            StartConstraint::Quiet {
                max_probability: 0.5,
                ms: 16
            };
            4
        ];
        assert!(
            evaluate_grouped(
                &inputs,
                &sources,
                &starts,
                baseline(),
                &AcceptancePolicy::default()
            )
            .unwrap()
            .accepted
        );
        let starts = vec![
            StartConstraint::Quiet {
                max_probability: 0.5,
                ms: 15
            };
            4
        ];
        assert!(
            !evaluate_grouped(
                &inputs,
                &sources,
                &starts,
                baseline(),
                &AcceptancePolicy::default()
            )
            .unwrap()
            .accepted
        );
        let mut inputs = inputs;
        for input in &mut inputs {
            for f in &mut input.frames[..100] {
                f.confidence = 0.48;
            }
            for f in &mut input.frames[100..] {
                f.confidence = 0.1;
            }
        }
        assert!(
            evaluate(&inputs, baseline(), &AcceptancePolicy::default())
                .unwrap()
                .accepted
        );
        let starts = vec![
            StartConstraint::Quiet {
                max_probability: 0.5,
                ms: 16
            };
            4
        ];
        let result = evaluate_grouped(
            &inputs,
            &sources,
            &starts,
            baseline(),
            &AcceptancePolicy::default(),
        )
        .unwrap();
        assert!(!result.accepted);
        assert!(result.selected.is_none());
        assert!(evaluate_grouped(
            &inputs,
            &sources,
            &[],
            baseline(),
            &AcceptancePolicy::default()
        )
        .is_err());
    }
}
