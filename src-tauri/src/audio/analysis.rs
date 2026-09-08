#[derive(Clone, Copy, Debug, Default)]
pub struct Features {
    pub level: f64,
    pub low: f64,
    pub mid: f64,
    pub high: f64,
}

#[derive(Clone, Copy)]
struct Biquad {
    b: [f64; 3],
    a: [f64; 2],
    z: [f64; 2],
}
impl Biquad {
    fn new(rate: f64, cutoff: f64, high: bool) -> Self {
        let omega = std::f64::consts::TAU * cutoff.min(rate * 0.45) / rate;
        let cos = omega.cos();
        let alpha = omega.sin() / std::f64::consts::SQRT_2;
        let gain = 1.0 + alpha;
        let b = if high {
            [(1.0 + cos) / 2.0, -(1.0 + cos), (1.0 + cos) / 2.0]
        } else {
            [(1.0 - cos) / 2.0, 1.0 - cos, (1.0 - cos) / 2.0]
        };
        Self {
            b: b.map(|v| v / gain),
            a: [-2.0 * cos / gain, (1.0 - alpha) / gain],
            z: [0.0; 2],
        }
    }
    fn sample(&mut self, x: f64) -> f64 {
        let out = self.b[0] * x + self.z[0];
        self.z[0] = self.b[1] * x - self.a[0] * out + self.z[1];
        self.z[1] = self.b[2] * x - self.a[1] * out;
        out
    }
}

pub struct Analyzer {
    filters: Vec<[Biquad; 4]>,
    power: [f64; 4],
    samples: usize,
}
impl Analyzer {
    pub fn new(sample_rate: f64, channels: usize) -> Self {
        Self {
            filters: vec![
                [
                    Biquad::new(sample_rate, 250.0, false),
                    Biquad::new(sample_rate, 250.0, true),
                    Biquad::new(sample_rate, 4_000.0, false),
                    Biquad::new(sample_rate, 4_000.0, true)
                ];
                channels
            ],
            power: [0.0; 4],
            samples: 0,
        }
    }
    pub fn sample(&mut self, channel: usize, sample: f64) {
        let Some(filters) = self.filters.get_mut(channel) else {
            return;
        };
        let x = if sample.is_finite() {
            sample.clamp(-1.0, 1.0)
        } else {
            0.0
        };
        let low = filters[0].sample(x);
        let mid = filters[1].sample(x);
        let mid = filters[2].sample(mid);
        let high = filters[3].sample(x);
        // Sum channel power, not waveforms: antiphase stereo must remain audible.
        for (sum, value) in self.power.iter_mut().zip([x, low, mid, high]) {
            *sum += value * value;
        }
        self.samples += 1;
    }
    pub fn finish(&mut self) -> Features {
        let energies = self.power.map(|power| {
            let rms = (power / self.samples.max(1) as f64).sqrt();
            if rms < 0.001 {
                0.0
            } else {
                (rms * 3.0).min(1.0)
            }
        });
        self.power = [0.0; 4];
        self.samples = 0;
        Features {
            level: energies[0],
            low: energies[1],
            mid: energies[2],
            high: energies[3],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tone(hz: f64, channels: usize) -> Features {
        let mut analyzer = Analyzer::new(48_000.0, channels);
        for n in 0..4_800 {
            let x = (n as f64 * hz * std::f64::consts::TAU / 48_000.0).sin() * 0.2;
            for channel in 0..channels {
                analyzer.sample(channel, if channel == 1 { -x } else { x });
            }
        }
        analyzer.finish()
    }
    #[test]
    fn tones_drive_their_own_band_without_cancelling_stereo() {
        for (hz, band) in [(80.0, 0), (1000.0, 1), (8000.0, 2)] {
            let f = tone(hz, 2);
            let bands = [f.low, f.mid, f.high];
            assert!(f.level > 0.3, "stereo signal cancelled: {f:?}");
            for (index, energy) in bands.iter().enumerate() {
                if index != band {
                    assert!(bands[band] > energy * 2.0, "{hz}: {f:?}");
                }
            }
        }
    }
    #[test]
    fn silence_and_invalid_samples_stay_finite_and_zero() {
        let mut analyzer = Analyzer::new(48_000.0, 2);
        for x in [0.0, f64::NAN, f64::INFINITY] {
            analyzer.sample(0, x);
        }
        let f = analyzer.finish();
        assert_eq!([f.level, f.low, f.mid, f.high], [0.0; 4]);
    }
}
