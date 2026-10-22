//! Observed request/recognition timing from capture events, not causal attribution.
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;

#[derive(Default, Serialize)]
pub struct CaptureMetrics {
    pub request_wait_us: u64,
    pub request_wait_with_vad_us: u64,
    pub request_wait_with_recognition_pending_us: u64,
    pub request_wait_with_both_us: u64,
    pub request_wait_with_unknown_state_us: u64,
    pub admitted_request_delays_us: Vec<u64>,
    pub unresolved_requests: u64,
    pub requests_censored_by_gap: u64,
    pub capture_gaps: u64,
    pub recognizer_events: u64,
    pub excluded_before_gap_us: u64,
    pub capture_limited: bool,
}

pub fn measure(events: &[Value]) -> Result<CaptureMetrics, String> {
    let mut result = CaptureMetrics::default();
    let mut pending = HashMap::<u64, u64>::new();
    let mut speaking = Some(false);
    let mut recognition = Some(false);
    let mut previous = None;
    for event in events {
        let us = event["us"]
            .as_u64()
            .ok_or("capture event needs unsigned us")?;
        let kind = event["type"].as_str().ok_or("capture event needs type")?;
        if previous.is_some_and(|previous| us < previous) {
            return Err("capture events must be ordered by monotonic us".into());
        }
        let duration = us - previous.unwrap_or(us);
        if matches!(kind, "gap" | "limit") {
            result.excluded_before_gap_us += duration;
        } else if !pending.is_empty() {
            result.request_wait_us += duration;
            match (speaking, recognition) {
                (Some(true), Some(true)) => result.request_wait_with_both_us += duration,
                (Some(true), Some(false)) => result.request_wait_with_vad_us += duration,
                (Some(false), Some(true)) => {
                    result.request_wait_with_recognition_pending_us += duration
                }
                (None, _) | (_, None) => result.request_wait_with_unknown_state_us += duration,
                _ => {}
            }
        }
        previous = Some(us);
        match kind {
            "gap" | "limit" => {
                result.capture_gaps += 1;
                result.capture_limited |= kind == "limit";
                result.requests_censored_by_gap += pending.len() as u64;
                pending.clear();
                speaking = None;
                recognition = None;
            }
            "recognizer" => {
                result.recognizer_events += 1;
            }
            "in" | "out" => {
                let message = &event["message"];
                let message_type = message["type"]
                    .as_str()
                    .ok_or("protocol event needs message.type")?;
                match (kind, message_type) {
                    ("in", "prepare_speak") => {
                        let id = message["id"].as_u64().ok_or("prepare_speak needs id")?;
                        if pending.insert(id, us).is_some() {
                            return Err("duplicate outstanding prepare_speak id".into());
                        }
                    }
                    ("out", "admitted" | "not_admitted" | "pending") => {
                        let id = message["id"].as_u64().ok_or("prepare outcome needs id")?;
                        if let Some(start) = pending.remove(&id) {
                            if message_type == "admitted" {
                                result.admitted_request_delays_us.push(us - start);
                            }
                        }
                    }
                    ("out", "input_speaking") => {
                        speaking = Some(
                            message["active"]
                                .as_bool()
                                .ok_or("input_speaking needs active")?,
                        );
                    }
                    ("out", "recognition_pending") => {
                        recognition = Some(
                            message["active"]
                                .as_bool()
                                .ok_or("recognition_pending needs active")?,
                        );
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
    result.unresolved_requests = pending.len() as u64;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn separates_vad_from_recognition_only_waiting() {
        let events = vec![
            json!({"us":0,"type":"out","message":{"type":"input_speaking","active":true}}),
            json!({"us":0,"type":"out","message":{"type":"recognition_pending","active":true}}),
            json!({"us":10,"type":"in","message":{"type":"prepare_speak","id":1}}),
            json!({"us":20,"type":"out","message":{"type":"input_speaking","active":false}}),
            json!({"us":50,"type":"out","message":{"type":"recognition_pending","active":false}}),
            json!({"us":60,"type":"out","message":{"type":"admitted","id":1}}),
        ];
        let result = measure(&events).unwrap();
        assert_eq!(result.request_wait_us, 50);
        assert_eq!(result.request_wait_with_both_us, 10);
        assert_eq!(result.request_wait_with_recognition_pending_us, 30);
        assert_eq!(result.admitted_request_delays_us, vec![50]);
    }
    #[test]
    fn gaps_censor_requests_instead_of_scoring_success() {
        let events = vec![
            json!({"us":0,"type":"in","message":{"type":"prepare_speak","id":1}}),
            json!({"us":20,"type":"gap","reason":"capture_dropped"}),
            json!({"us":30,"type":"out","message":{"type":"admitted","id":1}}),
        ];
        let result = measure(&events).unwrap();
        assert_eq!(result.requests_censored_by_gap, 1);
        assert_eq!(result.request_wait_us, 0);
        assert_eq!(result.excluded_before_gap_us, 20);
        assert!(result.admitted_request_delays_us.is_empty());
    }
}
