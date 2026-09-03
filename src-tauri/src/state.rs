use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HaloState {
    Idle,
    Thinking,
    Executing,
    InputNeeded,
    Completed,
    Compacting,
}

pub const STATE_PRIORITY: [HaloState; 6] = [
    HaloState::InputNeeded,
    HaloState::Compacting,
    HaloState::Executing,
    HaloState::Thinking,
    HaloState::Completed,
    HaloState::Idle,
];

const COMPLETED_EXPIRY_MS: i64 = 3_000;
const ACTIVE_EXPIRY_MS: i64 = 60_000;

const DEFAULT_IDLE_COLOR: &str = "#A7ADB5";
const DEFAULT_THINKING_COLOR: &str = "#FF8A3D";
const DEFAULT_EXECUTING_COLOR: &str = "#339CFF";
const DEFAULT_INPUT_NEEDED_COLOR: &str = "#F05252";
const DEFAULT_COMPLETED_COLOR: &str = "#35C878";
const DEFAULT_COMPACTING_COLOR: &str = "#A56BFF";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    pub session_key: String,
    pub state: HaloState,
    pub updated_at_ms: i64,
}

impl Snapshot {
    pub fn new(session_key: impl Into<String>, state: HaloState, updated_at_ms: i64) -> Self {
        Self {
            session_key: session_key.into(),
            state,
            updated_at_ms,
        }
    }
}

fn priority(state: HaloState) -> u8 {
    (STATE_PRIORITY.len()
        - STATE_PRIORITY
            .iter()
            .position(|candidate| *candidate == state)
            .unwrap()) as u8
}

fn expiry_ms(state: HaloState) -> Option<i64> {
    match state {
        HaloState::Completed => Some(COMPLETED_EXPIRY_MS),
        HaloState::Thinking | HaloState::Executing | HaloState::Compacting => {
            Some(ACTIVE_EXPIRY_MS)
        }
        HaloState::Idle => Some(ACTIVE_EXPIRY_MS),
        HaloState::InputNeeded => None,
    }
}

fn is_expired(snapshot: &Snapshot, now_ms: i64) -> bool {
    expiry_ms(snapshot.state)
        .map(|expiry| now_ms.saturating_sub(snapshot.updated_at_ms) > expiry)
        .unwrap_or(false)
}

fn is_current(snapshot: &Snapshot, now_ms: i64) -> bool {
    snapshot.updated_at_ms <= now_ms && !is_expired(snapshot, now_ms)
}

impl Default for HaloState {
    fn default() -> Self {
        Self::Idle
    }
}

#[derive(Clone, Serialize)]
pub struct DisplayState {
    pub state: HaloState,
    pub session_count: usize,
    pub updated_at_ms: i64,
}

impl DisplayState {
    pub fn idle() -> Self {
        Self {
            state: HaloState::Idle,
            session_count: 0,
            updated_at_ms: 0,
        }
    }
}

impl Default for DisplayState {
    fn default() -> Self {
        Self::idle()
    }
}

pub fn reduce_snapshots(snapshots: &[Snapshot], now_ms: i64) -> DisplayState {
    let current = snapshots
        .iter()
        .filter(|snapshot| is_current(snapshot, now_ms))
        .collect::<Vec<_>>();

    let selected = current
        .iter()
        .max_by_key(|snapshot| (priority(snapshot.state), snapshot.updated_at_ms));

    selected.map_or_else(DisplayState::idle, |snapshot| DisplayState {
        state: snapshot.state,
        session_count: current.len(),
        updated_at_ms: snapshot.updated_at_ms,
    })
}

#[derive(Default)]
pub struct SessionStore {
    sessions: HashMap<String, Snapshot>,
}

impl SessionStore {
    pub fn upsert(&mut self, snapshot: Snapshot) {
        self.sessions.insert(snapshot.session_key.clone(), snapshot);
    }

    pub fn remove(&mut self, session_key: &str) {
        self.sessions.remove(session_key);
    }

    pub fn display_state(&self, now_ms: i64) -> DisplayState {
        let snapshots = self.sessions.values().cloned().collect::<Vec<_>>();
        reduce_snapshots(&snapshots, now_ms)
    }

    pub fn display_state_with_override(
        &self,
        simulation: Option<&Snapshot>,
        now_ms: i64,
    ) -> DisplayState {
        let real = self.display_state(now_ms);
        let Some(simulation) = simulation.filter(|snapshot| is_current(snapshot, now_ms)) else {
            return real;
        };
        DisplayState {
            state: simulation.state,
            session_count: real.session_count,
            updated_at_ms: simulation.updated_at_ms,
        }
    }

    pub fn clear_expired(&mut self, now_ms: i64) {
        self.sessions
            .retain(|_, snapshot| is_current(snapshot, now_ms));
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct AppSettings {
    pub enabled: bool,
    pub opacity: f32,
    pub offset_x: i32,
    pub offset_y: i32,
    pub curve_id: String,
    pub particle_count: i32,
    pub trail_span: f32,
    pub duration_ms: f32,
    pub pulse_duration_ms: f32,
    pub rotation_duration_ms: f32,
    pub stroke_width: f32,
    pub idle_color: String,
    pub thinking_color: String,
    pub executing_color: String,
    pub input_needed_color: String,
    pub completed_color: String,
    pub compacting_color: String,
    pub start_at_login: bool,
    pub follow_codex_lifecycle: bool,
    pub language: String,
}

impl AppSettings {
    pub fn normalize(mut self) -> Result<Self, String> {
        if self.language != "en" && self.language != "zh-CN" {
            self.language = "en".to_owned();
        }

        if ![
            self.opacity,
            self.trail_span,
            self.duration_ms,
            self.pulse_duration_ms,
            self.rotation_duration_ms,
            self.stroke_width,
        ]
        .into_iter()
        .all(f32::is_finite)
        {
            return Err("settings contain non-finite numeric values".to_owned());
        }

        self.opacity = self.opacity.clamp(0.1, 1.0);
        self.offset_x = self.offset_x.clamp(-2_000, 2_000);
        self.offset_y = self.offset_y.clamp(-2_000, 2_000);
        self.particle_count = self.particle_count.clamp(24, 140);
        self.trail_span = self.trail_span.clamp(0.12, 0.68);
        self.stroke_width = self.stroke_width.clamp(2.5, 7.5);
        self.idle_color = normalize_color(self.idle_color)?;
        self.thinking_color = normalize_color(self.thinking_color)?;
        self.executing_color = normalize_color(self.executing_color)?;
        self.input_needed_color = normalize_color(self.input_needed_color)?;
        self.completed_color = normalize_color(self.completed_color)?;
        self.compacting_color = normalize_color(self.compacting_color)?;
        Ok(self)
    }
}

fn normalize_color(value: String) -> Result<String, String> {
    let bytes = value.as_bytes();
    if bytes.len() != 7
        || bytes[0] != b'#'
        || !bytes[1..].iter().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("settings contain invalid color values".to_owned());
    }
    Ok(value.to_ascii_uppercase())
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            opacity: 1.0,
            offset_x: 28,
            offset_y: 140,
            curve_id: "rose-seven".to_owned(),
            particle_count: 64,
            trail_span: 0.4,
            duration_ms: 420.0,
            pulse_duration_ms: 1_200.0,
            rotation_duration_ms: 4_200.0,
            stroke_width: 4.0,
            idle_color: DEFAULT_IDLE_COLOR.to_owned(),
            thinking_color: DEFAULT_THINKING_COLOR.to_owned(),
            executing_color: DEFAULT_EXECUTING_COLOR.to_owned(),
            input_needed_color: DEFAULT_INPUT_NEEDED_COLOR.to_owned(),
            completed_color: DEFAULT_COMPLETED_COLOR.to_owned(),
            compacting_color: DEFAULT_COMPACTING_COLOR.to_owned(),
            start_at_login: false,
            follow_codex_lifecycle: false,
            language: "en".to_owned(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_the_required_state_priority_order() {
        assert_eq!(priority(HaloState::InputNeeded), 6);
        assert_eq!(priority(HaloState::Idle), 1);
    }

    #[test]
    fn serializes_states_to_the_exact_wire_values() {
        let cases = [
            (HaloState::Idle, "idle"),
            (HaloState::Thinking, "thinking"),
            (HaloState::Executing, "executing"),
            (HaloState::InputNeeded, "input_needed"),
            (HaloState::Completed, "completed"),
            (HaloState::Compacting, "compacting"),
        ];

        for (state, expected) in cases {
            assert_eq!(
                serde_json::to_string(&state).unwrap(),
                format!("\"{expected}\"")
            );
        }
    }

    #[test]
    fn reduces_snapshots_by_priority_then_recency() {
        let now = 1_000_000;
        assert_eq!(
            reduce_snapshots(
                &[
                    Snapshot::new("a", HaloState::Thinking, now - 200),
                    Snapshot::new("b", HaloState::Executing, now - 100),
                ],
                now,
            )
            .state,
            HaloState::Executing
        );
        assert_eq!(
            reduce_snapshots(
                &[
                    Snapshot::new("a", HaloState::Executing, now - 200),
                    Snapshot::new("b", HaloState::InputNeeded, now - 100),
                ],
                now,
            )
            .state,
            HaloState::InputNeeded
        );
        assert_eq!(
            reduce_snapshots(
                &[
                    Snapshot::new("a", HaloState::Thinking, now - 200),
                    Snapshot::new("b", HaloState::Thinking, now - 100),
                ],
                now,
            )
            .updated_at_ms,
            now - 100
        );
    }

    #[test]
    fn expires_completed_after_three_seconds() {
        let now = 1_000_000;
        assert_eq!(
            reduce_snapshots(
                &[Snapshot::new("a", HaloState::Completed, now - 3_001)],
                now
            )
            .state,
            HaloState::Idle
        );
    }

    #[test]
    fn keeps_input_needed_until_another_event() {
        let now = 1_000_000;
        assert_eq!(
            reduce_snapshots(
                &[Snapshot::new("a", HaloState::InputNeeded, now - 86_400_000)],
                now,
            )
            .state,
            HaloState::InputNeeded
        );
    }

    #[test]
    fn rejects_malformed_state_strings() {
        let cases = [
            r#"{"session_key":"a","state":"working","updated_at_ms":100}"#,
            r#"{"session_key":"a","state":"","updated_at_ms":100}"#,
            r#"{"session_key":"a","state":null,"updated_at_ms":100}"#,
        ];

        for raw in cases {
            assert!(serde_json::from_str::<Snapshot>(raw).is_err(), "{raw}");
        }
    }

    #[test]
    fn rejects_content_fields() {
        let raw = r#"{"session_key":"a","state":"thinking","updated_at_ms":100,"prompt":"secret"}"#;

        assert!(serde_json::from_str::<Snapshot>(raw).is_err());
    }

    #[test]
    fn expires_active_states_older_than_sixty_seconds() {
        let now = 1_000_000;
        let cases = [
            HaloState::Idle,
            HaloState::Thinking,
            HaloState::Executing,
            HaloState::Compacting,
        ];

        for state in cases {
            assert_eq!(
                reduce_snapshots(&[Snapshot::new("a", state, now - 60_001)], now,).state,
                HaloState::Idle,
            );
        }
    }

    #[test]
    fn keeps_states_at_exact_expiry_boundaries() {
        let now = 1_000_000;
        let cases = [
            (HaloState::Completed, 3_000),
            (HaloState::Idle, 60_000),
            (HaloState::Thinking, 60_000),
            (HaloState::Executing, 60_000),
            (HaloState::Compacting, 60_000),
        ];

        for (state, age_ms) in cases {
            let display = reduce_snapshots(&[Snapshot::new("a", state, now - age_ms)], now);
            assert_eq!(display.state, state);
            assert_eq!(display.updated_at_ms, now - age_ms);
        }
    }

    #[test]
    fn rejects_future_timestamps_after_clock_rollback() {
        let now = 1_000_000;
        let display = reduce_snapshots(
            &[
                Snapshot::new("fresh", HaloState::Thinking, now - 100),
                Snapshot::new("future", HaloState::Thinking, now + 1),
            ],
            now,
        );

        assert_eq!(display.state, HaloState::Thinking);
        assert_eq!(display.session_count, 1);
        assert_eq!(display.updated_at_ms, now - 100);
        assert_eq!(
            reduce_snapshots(
                &[Snapshot::new("future", HaloState::Executing, now + 1)],
                now,
            )
            .state,
            HaloState::Idle,
        );
    }

    #[test]
    fn session_store_updates_replaces_and_removes_sessions() {
        let mut store = SessionStore::default();
        store.upsert(Snapshot::new("a", HaloState::Thinking, 100));
        store.upsert(Snapshot::new("b", HaloState::Executing, 200));

        assert_eq!(store.display_state(1_000).session_count, 2);
        assert_eq!(store.display_state(1_000).state, HaloState::Executing);

        store.upsert(Snapshot::new("a", HaloState::InputNeeded, 300));
        assert_eq!(store.display_state(1_000).state, HaloState::InputNeeded);

        store.remove("a");
        assert_eq!(store.display_state(1_000).state, HaloState::Executing);
        assert_eq!(store.display_state(1_000).session_count, 1);
    }

    #[test]
    fn session_store_clears_expired_snapshots() {
        let now = 1_000_000;
        let mut store = SessionStore::default();
        store.upsert(Snapshot::new("a", HaloState::Completed, now - 3_001));
        store.upsert(Snapshot::new("b", HaloState::InputNeeded, now - 86_400_000));

        store.clear_expired(now);

        assert_eq!(store.display_state(now).state, HaloState::InputNeeded);
        assert_eq!(store.display_state(now).session_count, 1);
    }

    #[test]
    fn normalizes_settings_to_the_native_control_bounds() {
        let mut settings = AppSettings::default();
        settings.opacity = 0.01;
        settings.offset_x = i32::MAX;
        settings.offset_y = i32::MIN;
        settings.particle_count = 1;
        settings.trail_span = 1.0;
        settings.stroke_width = 10.0;

        let normalized = settings.normalize().unwrap();

        assert_eq!(normalized.opacity, 0.1);
        assert_eq!(normalized.offset_x, 2_000);
        assert_eq!(normalized.offset_y, -2_000);
        assert_eq!(normalized.particle_count, 24);
        assert_eq!(normalized.trail_span, 0.68);
        assert_eq!(normalized.stroke_width, 7.5);
    }

    #[test]
    fn defaults_to_english_language() {
        assert_eq!(AppSettings::default().language, "en");
    }

    #[test]
    fn normalizes_unsupported_language_to_english() {
        let mut settings = AppSettings::default();
        settings.language = "fr".to_owned();

        assert_eq!(settings.normalize().unwrap().language, "en");
    }

    #[test]
    fn missing_language_uses_the_english_default() {
        let settings: AppSettings = serde_json::from_str("{}").unwrap();

        assert_eq!(settings.language, "en");
    }

    #[test]
    fn missing_lifecycle_flag_uses_disabled_default() {
        let settings: AppSettings = serde_json::from_str("{}").unwrap();

        assert!(!settings.follow_codex_lifecycle);
    }

    #[test]
    fn rejects_non_finite_settings_numbers() {
        let mut settings = AppSettings::default();
        settings.trail_span = f32::NAN;

        assert!(settings.normalize().is_err());
    }

    #[test]
    fn serializes_the_complete_settings_contract() {
        let value = serde_json::to_value(AppSettings::default()).unwrap();
        for key in [
            "enabled",
            "opacity",
            "offset_x",
            "offset_y",
            "curve_id",
            "particle_count",
            "trail_span",
            "duration_ms",
            "pulse_duration_ms",
            "rotation_duration_ms",
            "stroke_width",
            "idle_color",
            "thinking_color",
            "executing_color",
            "input_needed_color",
            "completed_color",
            "compacting_color",
            "start_at_login",
            "language",
        ] {
            assert!(value.get(key).is_some(), "missing {key}");
        }
    }

    #[test]
    fn missing_state_colors_use_the_existing_renderer_defaults() {
        let settings: AppSettings = serde_json::from_str("{}").unwrap();

        assert_eq!(settings.idle_color, "#A7ADB5");
        assert_eq!(settings.thinking_color, "#FF8A3D");
        assert_eq!(settings.executing_color, "#339CFF");
        assert_eq!(settings.input_needed_color, "#F05252");
        assert_eq!(settings.completed_color, "#35C878");
        assert_eq!(settings.compacting_color, "#A56BFF");
    }

    #[test]
    fn normalizes_lowercase_state_colors_to_uppercase() {
        let mut settings = AppSettings::default();
        settings.idle_color = "#abcdef".to_owned();

        assert_eq!(settings.normalize().unwrap().idle_color, "#ABCDEF");
    }

    #[test]
    fn rejects_invalid_state_colors() {
        let mut settings = AppSettings::default();
        settings.completed_color = "not-a-color".to_owned();

        assert!(settings.normalize().is_err());
    }
}
