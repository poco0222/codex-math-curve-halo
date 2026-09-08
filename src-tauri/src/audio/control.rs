use super::Snapshot;

#[derive(Default)]
pub(super) struct Control {
    pub enabled: bool,
    pub visible: bool,
    pub reduced_motion: Option<bool>,
    pub exit: bool,
    pub snapshot: Snapshot,
    pub blocked: Option<(&'static str, &'static str)>,
}
impl Control {
    pub fn waiting_for_audio(&mut self, generation: u64, timestamp_ms: i64) {
        if generation != self.snapshot.generation || !self.runnable() {
            return;
        }
        self.expire(timestamp_ms);
        if self.snapshot.status == "starting" {
            self.snapshot.reason = Some("awaiting_audio");
        } else if self.snapshot.status == "silent" {
            self.snapshot.timestamp_ms = timestamp_ms;
        }
    }

    pub fn expire(&mut self, timestamp_ms: i64) {
        if matches!(self.snapshot.status, "capturing" | "silent")
            && timestamp_ms.saturating_sub(self.snapshot.timestamp_ms) > 500
        {
            self.snapshot.status = "silent";
            self.snapshot.reason = None;
            self.snapshot.timestamp_ms = timestamp_ms;
            self.snapshot.level = 0.0;
            self.snapshot.low = 0.0;
            self.snapshot.mid = 0.0;
            self.snapshot.high = 0.0;
        }
    }
    pub fn runnable(&self) -> bool {
        self.enabled
            && self.visible
            && self.reduced_motion == Some(false)
            && !self.exit
            && self.blocked.is_none()
    }
    pub fn refresh(&mut self) {
        let (status, reason) = if !self.enabled || self.exit {
            ("disabled", None)
        } else if !self.visible {
            ("paused", Some("hidden"))
        } else if self.reduced_motion.is_none() {
            ("paused", Some("motion_pending"))
        } else if self.reduced_motion == Some(true) {
            ("paused", Some("reduced_motion"))
        } else if let Some((status, reason)) = self.blocked {
            (status, Some(reason))
        } else {
            ("starting", None)
        };
        self.snapshot = Snapshot {
            generation: self.snapshot.generation + 1,
            timestamp_ms: super::now_ms(),
            status,
            reason,
            ..Snapshot::default()
        };
    }
    pub fn accept(
        &mut self,
        generation: u64,
        features: super::analysis::Features,
        timestamp_ms: i64,
    ) -> bool {
        if generation != self.snapshot.generation || !self.runnable() {
            return false;
        }
        let dt = (timestamp_ms - self.snapshot.timestamp_ms).clamp(1, 100) as f64 / 1000.0;
        let smooth = |old: f64, next: f64| {
            let tau = if next > old { 0.04 } else { 0.18 };
            (old + (next - old) * (1.0 - (-dt / tau).exp())).clamp(0.0, 1.0)
        };
        self.snapshot.status = if features.level == 0.0 {
            "silent"
        } else {
            "capturing"
        };
        self.snapshot.reason = None;
        self.snapshot.level = features.level;
        self.snapshot.low = smooth(self.snapshot.low, features.low);
        self.snapshot.mid = smooth(self.snapshot.mid, features.mid);
        self.snapshot.high = smooth(self.snapshot.high, features.high);
        self.snapshot.timestamp_ms = timestamp_ms;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::analysis::Features;
    #[test]
    fn capture_requires_all_gates_and_late_frames_cannot_revive_it() {
        let mut c = Control::default();
        c.enabled = true;
        c.refresh();
        assert_eq!(c.snapshot.status, "paused");
        c.visible = true;
        c.refresh();
        assert_eq!(c.snapshot.reason, Some("motion_pending"));
        c.reduced_motion = Some(false);
        c.refresh();
        assert_eq!(c.snapshot.status, "starting");
        let generation = c.snapshot.generation;
        assert!(c.accept(
            generation,
            Features {
                level: 0.5,
                low: 0.3,
                mid: 0.2,
                high: 0.1
            },
            1
        ));
        assert_eq!(c.snapshot.status, "capturing");
        c.visible = false;
        c.refresh();
        assert!(!c.accept(
            generation,
            Features {
                level: 1.0,
                ..Features::default()
            },
            2
        ));
        assert_eq!(c.snapshot.level, 0.0);
        c.visible = true;
        c.reduced_motion = Some(true);
        c.refresh();
        assert_eq!(c.snapshot.reason, Some("reduced_motion"));
    }
    #[test]
    fn healthy_idle_waits_without_restarting_and_music_can_resume() {
        let mut c = Control {
            enabled: true,
            visible: true,
            reduced_motion: Some(false),
            ..Control::default()
        };
        c.refresh();
        let generation = c.snapshot.generation;
        for now in [1000, 5000, 10000] {
            c.waiting_for_audio(generation, now);
            assert_eq!(c.snapshot.status, "starting");
            assert_eq!(c.snapshot.reason, Some("awaiting_audio"));
            assert_eq!(c.snapshot.generation, generation);
        }
        let music = Features {
            level: 0.8,
            low: 0.3,
            mid: 0.2,
            high: 0.1,
        };
        c.accept(generation, music, 11000);
        assert_eq!(c.snapshot.status, "capturing");
        c.waiting_for_audio(generation, 11501);
        assert_eq!(c.snapshot.status, "silent");
        assert_eq!(
            [
                c.snapshot.level,
                c.snapshot.low,
                c.snapshot.mid,
                c.snapshot.high
            ],
            [0.0; 4]
        );
        assert_eq!(c.snapshot.generation, generation);
        c.accept(generation, music, 12000);
        assert_eq!(c.snapshot.status, "capturing");
    }

    #[test]
    fn stale_features_become_silent_and_zero() {
        let mut c = Control {
            enabled: true,
            visible: true,
            reduced_motion: Some(false),
            ..Control::default()
        };
        c.refresh();
        let generation = c.snapshot.generation;
        c.accept(
            generation,
            Features {
                level: 0.8,
                low: 0.5,
                mid: 0.3,
                high: 0.1,
            },
            1000,
        );
        c.expire(1501);
        assert_eq!(c.snapshot.status, "silent");
        assert_eq!(
            [
                c.snapshot.level,
                c.snapshot.low,
                c.snapshot.mid,
                c.snapshot.high
            ],
            [0.0; 4]
        );
        assert_eq!(c.snapshot.reason, None);
    }

    #[test]
    fn permission_denial_survives_hide_show_and_cannot_consume_frames() {
        let mut c = Control {
            enabled: true,
            visible: true,
            reduced_motion: Some(false),
            ..Control::default()
        };
        c.blocked = Some(("permission_denied", "permission"));
        c.refresh();
        let generation = c.snapshot.generation;
        assert!(!c.accept(generation, Features::default(), 3));
        c.visible = false;
        c.refresh();
        c.visible = true;
        c.refresh();
        assert_eq!(c.snapshot.status, "permission_denied");
    }
}
