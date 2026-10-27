"""
Acoustic Siren Harmonic Verifier for Pravaah AI.
Detects frequency-modulated emergency Wail/Yelp sweeps in 16kHz PCM audio buffers.
"""
from typing import Tuple
import numpy as np
from scipy.signal import stft


class AcousticSirenVerifier:
    """Detects frequency-modulated emergency Wail/Yelp sweeps in 16kHz PCM audio buffers."""

    def __init__(self, sample_rate: int = 16000, min_snr_db: float = 12.0):
        self.sr = sample_rate
        self.min_snr_db = min_snr_db

    def detect_siren_sweep(self, audio_pcm_float: np.ndarray) -> Tuple[bool, float]:
        """
        Inspects a 1.5-second mono audio window.
        Returns (is_emergency_siren, measured_snr_db).
        """
        if audio_pcm_float is None or audio_pcm_float.size < self.sr:
            return False, 0.0

        freqs, _, zxx = stft(audio_pcm_float, fs=self.sr, nperseg=1024, noverlap=512)
        mag = np.abs(zxx)

        band_mask = (freqs >= 650.0) & (freqs <= 1580.0)
        noise_mask = (freqs >= 150.0) & (freqs < 550.0)
        if not np.any(band_mask):
            return False, 0.0

        siren_band = mag[band_mask, :]
        siren_freqs = freqs[band_mask]

        band_peak_energy = float(np.mean(np.max(siren_band, axis=0) ** 2) + 1e-9)
        background_energy = float(np.mean(mag[noise_mask, :] ** 2) + 1e-9)
        snr_db = 10.0 * np.log10(band_peak_energy / background_energy)
        if snr_db < self.min_snr_db:
            return False, round(snr_db, 1)

        # Track dominant frequency trajectory across STFT time frames
        dominant_f_track = siren_freqs[np.argmax(siren_band, axis=0)]
        freq_span_hz = float(np.percentile(dominant_f_track, 90) - np.percentile(dominant_f_track, 10))
        frame_deltas = np.abs(np.diff(dominant_f_track))
        smooth_sweep_ratio = float(np.mean((frame_deltas > 8.0) & (frame_deltas < 180.0)))

        # Authentic siren sweeps >= 220 Hz across 1.5s with continuous monotonic pitch glide
        is_siren = (freq_span_hz >= 220.0) and (smooth_sweep_ratio >= 0.35)
        return is_siren, round(snr_db, 1)
