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
        HaloState::Idle | HaloState::InputNeeded => None,
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

    pub fn clear_expired(&mut self, now_ms: i64) {
        self.sessions
            .retain(|_, snapshot| is_current(snapshot, now_ms));
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub enabled: bool,
    pub opacity: f32,
    pub offset_x: i32,
    pub offset_y: i32,
    pub curve_id: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            opacity: 1.0,
            offset_x: 28,
            offset_y: 140,
            curve_id: "rose-seven".to_owned(),
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
}
