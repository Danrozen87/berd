use berd_call::{detection::DetectionSettings, macos_audio_route::AudioSetup};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[derive(Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Profiles {
    profiles: BTreeMap<String, DetectionSettings>,
}

pub fn settings_for_start(
    persisted: Option<DetectionSettings>,
    configured: DetectionSettings,
    arguments: &[String],
) -> Result<DetectionSettings, String> {
    let mut settings = persisted.unwrap_or(configured);
    for pair in berd_call::detection::detection_arguments(arguments).chunks_exact(2) {
        match pair[0].as_str() {
            "--pending-utterance-timeout-ms" => {
                settings.pending_utterance_timeout_ms = configured.pending_utterance_timeout_ms
            }
            "--listening-threshold" => settings.listening.value = configured.listening.value,
            "--interruption-threshold" => {
                settings.interruption.value = configured.interruption.value
            }
            "--dynamic-listening" => settings.listening.dynamic = configured.listening.dynamic,
            "--dynamic-interruption" => {
                settings.interruption.dynamic = configured.interruption.dynamic
            }
            _ => {}
        }
    }
    settings.validate()
}

pub fn path() -> Result<PathBuf, String> {
    Ok(crate::saved_settings::path()?.with_file_name("detection-profiles.json"))
}

fn key(setup: &AudioSetup) -> String {
    serde_json::to_string(&[&setup.input_uid, &setup.output_uid]).expect("device strings serialize")
}

fn read(path: &Path) -> Result<Profiles, String> {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Profiles::default())
        }
        Err(error) => return Err(error.to_string()),
    };
    let mut bytes = Vec::new();
    file.take(65537)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() > 65536 {
        return Err("speech profiles exceed 64 KiB".into());
    }
    let profiles: Profiles = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    if profiles.profiles.len() > 64 {
        return Err("too many speech profiles".into());
    }
    for settings in profiles.profiles.values() {
        settings.validate()?;
    }
    Ok(profiles)
}

pub fn load(path: &Path, setup: &AudioSetup) -> Result<Option<DetectionSettings>, String> {
    Ok(read(path)?.profiles.get(&key(setup)).copied())
}

pub fn save(path: &Path, setup: &AudioSetup, settings: DetectionSettings) -> Result<(), String> {
    write(path, setup, settings, None).map(|_| ())
}

pub fn save_if_unchanged(
    path: &Path,
    setup: &AudioSetup,
    expected: Option<DetectionSettings>,
    settings: DetectionSettings,
) -> Result<bool, String> {
    write(path, setup, settings, Some(expected))
}

fn write(
    path: &Path,
    setup: &AudioSetup,
    settings: DetectionSettings,
    expected: Option<Option<DetectionSettings>>,
) -> Result<bool, String> {
    settings.validate()?;
    let parent = path
        .parent()
        .ok_or("speech profiles need a parent directory")?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path.with_extension("json.lock"))
        .map_err(|error| error.to_string())?;
    fs2::FileExt::lock_exclusive(&lock).map_err(|error| error.to_string())?;
    let mut profiles = read(path)?;
    if expected.is_some_and(|expected| profiles.profiles.get(&key(setup)).copied() != expected) {
        return Ok(false);
    }
    if profiles.profiles.get(&key(setup)) == Some(&settings) {
        return Ok(true);
    }
    profiles.profiles.insert(key(setup), settings);
    if profiles.profiles.len() > 64 {
        return Err("too many speech profiles".into());
    }
    let bytes = serde_json::to_vec_pretty(&profiles).map_err(|error| error.to_string())?;
    if bytes.len() > 65536 {
        return Err("speech profiles exceed 64 KiB".into());
    }
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    file.write_all(&bytes)
        .and_then(|()| file.as_file().sync_all())
        .map_err(|error| error.to_string())?;
    file.persist(path).map_err(|error| error.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup(input: &str, output: &str) -> AudioSetup {
        AudioSetup {
            input_uid: input.into(),
            output_uid: output.into(),
            input_name: "same display name".into(),
            output_name: "same display name".into(),
        }
    }
    #[test]
    fn explicit_start_and_restart_flags_override_only_their_profile_choices() {
        let mut profile = DetectionSettings::default();
        profile.pending_utterance_timeout_ms = 12345;
        profile.listening.value = 0.73;
        profile.listening.dynamic = true;
        profile.interruption.value = 0.82;
        let mut configured = DetectionSettings::default();
        configured.pending_utterance_timeout_ms = 750;
        configured.listening.value = 0.8;
        configured.interruption.dynamic = true;
        let arguments = [
            "session",
            "--listening-threshold",
            "0.8",
            "--dynamic-interruption",
            "true",
        ]
        .map(str::to_string);
        let restored = settings_for_start(Some(profile), configured, &arguments).unwrap();
        assert_eq!(restored.pending_utterance_timeout_ms, 12345);
        let explicit = ["--pending-utterance-timeout-ms", "750"].map(str::to_string);
        assert_eq!(
            settings_for_start(Some(profile), configured, &explicit)
                .unwrap()
                .pending_utterance_timeout_ms,
            750
        );
        assert!(berd_call::detection::without_detection_arguments(&explicit).is_empty());
        assert_eq!(restored.listening.value, 0.8);
        assert!(restored.listening.dynamic);
        assert_eq!(restored.interruption.value, 0.82);
        assert!(restored.interruption.dynamic);
        let inherited = berd_call::detection::without_detection_arguments(&arguments);
        assert_eq!(inherited, ["session"]);
        assert_eq!(
            settings_for_start(Some(profile), configured, &inherited).unwrap(),
            profile
        );
    }

    #[test]
    fn late_learning_cannot_overwrite_an_explicit_profile_edit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("profiles.json");
        let setup = setup("mic", "output");
        let original = DetectionSettings::default();
        save(&path, &setup, original).unwrap();
        let mut edited = original;
        edited.listening.value = 0.77;
        save(&path, &setup, edited).unwrap();
        let mut learned = original;
        learned.listening.value = 0.51;
        assert!(!save_if_unchanged(&path, &setup, Some(original), learned).unwrap());
        assert_eq!(load(&path, &setup).unwrap(), Some(edited));
        assert!(save_if_unchanged(&path, &setup, Some(edited), learned).unwrap());
    }

    #[test]
    fn profiles_are_isolated_by_both_stable_device_ids_and_survive_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("profiles.json");
        let airpods = setup("airpods-mic", "airpods-output");
        let mixed = setup("mac-mic", "airpods-output");
        let mut first = DetectionSettings::default();
        first.pending_utterance_timeout_ms = 12345;
        first.listening.value = 0.71;
        first.listening.dynamic = true;
        let mut second = DetectionSettings::default();
        second.pending_utterance_timeout_ms = 750;
        second.interruption.value = 0.83;
        save(&path, &airpods, first).unwrap();
        save(&path, &mixed, second).unwrap();
        assert_eq!(load(&path, &airpods).unwrap(), Some(first));
        assert_eq!(load(&path, &mixed).unwrap(), Some(second));
        assert_eq!(
            load(&path, &setup("headset-mic", "headset-output")).unwrap(),
            None
        );
        assert!(!std::fs::read_to_string(path)
            .unwrap()
            .contains("same display name"));
    }
}
