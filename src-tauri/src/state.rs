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
