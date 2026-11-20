"""Landmark audio fingerprinting (Shazam-style peak-pair hashes), numpy only."""
from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

SR = 11025
FRAME = 4096
HOP = 1024
PEAKS_PER_FRAME = 6
PEAKS_PER_SEC = 30
ANCHORS_PER_SEC = 8
TARGET_ZONE_FRAMES = 21  # ~2s ahead of each anchor
FANOUT = 3
FREQ_MIN_BIN = 4
FREQ_MAX_BIN = 400

SPEAKER_FRAME = 2048
SPEAKER_HOP = 256
SPEAKER_BANDS = (42, 67, 105, 163, 251, 386, 591, 815)


def decode_mono(path: str | Path) -> np.ndarray:
    """Decode any audio file to mono 11025Hz float32 via ffmpeg."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        out = tmp.name
    try:
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", str(path),
             "-ac", "1", "-ar", str(SR), "-f", "f32le", out],
            check=True,
        )
        return np.fromfile(out, dtype=np.float32).copy()
    finally:
        Path(out).unlink(missing_ok=True)


def _spectrogram(x: np.ndarray) -> np.ndarray:
    if len(x) < FRAME:
        x = np.pad(x, (0, FRAME - len(x)))
    n_frames = 1 + (len(x) - FRAME) // HOP
    idx = np.arange(FRAME)[None, :] + HOP * np.arange(n_frames)[:, None]
    windowed = x[idx] * np.hanning(FRAME)
    return np.abs(np.fft.rfft(windowed, axis=1))


def _peaks(S: np.ndarray) -> list[tuple[int, int, float]]:
    """(frame, bin, mag) peaks, capped per frame and per second by strength."""
    S = S[:, FREQ_MIN_BIN:FREQ_MAX_BIN]
    left = np.zeros_like(S)
    left[:, 1:] = S[:, :-1]
    right = np.zeros_like(S)
    right[:, :-1] = S[:, 1:]
    mask = (S > left) & (S >= right)
    floor = np.median(S, axis=1, keepdims=True) * 1.5 + 1e-6
    cand: list[tuple[int, int, float]] = []
    for t in range(S.shape[0]):
        cols = np.flatnonzero(mask[t] & (S[t] > floor[t, 0]))
        if cols.size == 0:
            continue
        order = np.argsort(S[t, cols])[::-1][:PEAKS_PER_FRAME]
        for c in cols[order]:
            cand.append((t, int(c) + FREQ_MIN_BIN, float(S[t, c])))
    cand.sort(key=lambda p: -p[2])
    peaks: list[tuple[int, int, float]] = []
    per_sec: dict[int, int] = {}
    for t, b, m in cand:
        sec = (t * HOP) // SR
        if per_sec.get(sec, 0) >= PEAKS_PER_SEC:
            continue
        per_sec[sec] = per_sec.get(sec, 0) + 1
        peaks.append((t, b, m))
    peaks.sort()
    return peaks


def fingerprint_hashes(x: np.ndarray) -> list[tuple[int, int]]:
    """Return (hash, frame) list for mono samples at SR (~20/sec)."""
    peaks = _peaks(_spectrogram(x))
    # Strongest ANCHORS_PER_SEC peaks become anchors.
    anchors = sorted(peaks, key=lambda p: -p[2])
    kept: list[tuple[int, int, float]] = []
    per_sec: dict[int, int] = {}
    for t, b, m in anchors:
        sec = (t * HOP) // SR
        if per_sec.get(sec, 0) >= ANCHORS_PER_SEC:
            continue
        per_sec[sec] = per_sec.get(sec, 0) + 1
        kept.append((t, b, m))
    by_frame: dict[int, list[tuple[int, float]]] = {}
    for t, b, m in peaks:
        by_frame.setdefault(t, []).append((b, m))
    for v in by_frame.values():
        v.sort(key=lambda bm: -bm[1])
    frames = sorted(by_frame)
    pos = {t: i for i, t in enumerate(frames)}
    out: list[tuple[int, int]] = []
    for t1, b1, _ in sorted(kept):
        n = 0
        for t2 in frames[pos[t1] + 1:]:
            if t2 - t1 > TARGET_ZONE_FRAMES:
                break
            for b2, _ in by_frame[t2][:2]:
                h = (b1 & 0x3FF) | ((b2 & 0x3FF) << 10) | (((t2 - t1) & 0xFF) << 20)
                out.append((h, t1))
                n += 1
                if n >= FANOUT:
                    break
            if n >= FANOUT:
                break
    return out


def fingerprint_file(path: str | Path) -> list[tuple[int, int]]:
    return fingerprint_hashes(decode_mono(path))


def speaker_hashes(x: np.ndarray) -> list[tuple[int, int]]:
    """Pair local peaks within frequency bands to tolerate speaker and mic EQ."""
    if len(x) < SPEAKER_FRAME:
        return []
    frames = sliding_window_view(x, SPEAKER_FRAME)[::SPEAKER_HOP]
    window = np.hanning(SPEAKER_FRAME).astype(np.float32)
    last_bin = SPEAKER_BANDS[-1] + 1
    spectrum = np.empty((len(frames), last_bin), dtype=np.float32)
    # Bound the temporary FFT arrays for full-length reference tracks.
    for start in range(0, len(frames), 256):
        batch = frames[start:start + 256] * window
        spectrum[start:start + len(batch)] = np.abs(np.fft.rfft(batch))[:, :last_bin]

    center = spectrum[:, 1:-1]
    peaks = (center > spectrum[:, :-2]) & (center >= spectrum[:, 2:])
    for distance in (1, 2, 3):
        peaks[distance:] &= center[distance:] > center[:-distance]
        peaks[:-distance] &= center[:-distance] >= center[distance:]

    pairs: set[tuple[int, int]] = set()
    for low, high in zip(SPEAKER_BANDS, SPEAKER_BANDS[1:]):
        band = spectrum[:, low:high]
        floor = np.maximum(np.median(band, axis=1) * 8 + 0.002, band.max(axis=1) * 0.55)
        times, bins = np.nonzero(peaks[:, low - 1:high - 1] & (band > floor[:, None]))
        frequencies = ((bins + low + 1) // 3).tolist()
        # Pair up to four targets from about 90 ms to 1.3 s after each anchor.
        first = np.searchsorted(times, times + 4)
        last = np.minimum(first + 4, np.searchsorted(times, times + 55, side="right"))
        anchors = times.tolist()
        for i, time in enumerate(anchors):
            for j in range(first[i], last[i]):
                delta = (anchors[j] - time + 1) // 2
                h = frequencies[i] | frequencies[j] << 10 | delta << 20
                pairs.add((h, time))
    return sorted(pairs, key=lambda pair: (pair[1], pair[0]))
