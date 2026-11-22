#!/usr/bin/env python3
"""CPU MMS forced-alignment sidecar.

One model load at startup. POST /align takes a wav and one roman syllable per
character and returns plain token spans in seconds. It does not join starts
and it has no per-character rules. Weights are CC-BY-NC 4.0 (personal use)
and are cached under TORCH_HOME.
"""

from __future__ import annotations

import base64
import io
import json
import os
import resource
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import torch
import torchaudio

PORT = int(os.environ.get("ALIGN_PORT", "8000"))
MAX_BODY = 8_000_000
DEVICE = torch.device("cpu")

BUNDLE = None
MODEL = None
TOKENIZER = None
ALIGNER = None
DICTIONARY: dict[str, int] = {}
LOAD_ERROR = ""
LOCK = threading.Lock()


def rss_mb() -> float:
    # Linux ru_maxrss is kilobytes.
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024


def load_model() -> None:
    global BUNDLE, MODEL, TOKENIZER, ALIGNER, DICTIONARY, LOAD_ERROR
    started = time.perf_counter()
    try:
        bundle = torchaudio.pipelines.MMS_FA
        model = bundle.get_model().to(DEVICE)
        model.eval()
        dictionary = dict(bundle.get_dict())
        BUNDLE = bundle
        MODEL = model
        TOKENIZER = bundle.get_tokenizer()
        ALIGNER = bundle.get_aligner()
        DICTIONARY = dictionary
        print(
            f"mms_fa ready in {time.perf_counter() - started:.1f}s "
            f"rss_mb={rss_mb():.0f} tokens={len(dictionary)}",
            flush=True,
        )
    except Exception as err:  # noqa: BLE001 — startup must stay up so the app can fall back
        LOAD_ERROR = str(err)
        print(f"mms_fa load failed: {LOAD_ERROR}", flush=True)


def read_wav(data: bytes) -> tuple[np.ndarray, int]:
    with wave.open(io.BytesIO(data), "rb") as handle:
        rate = handle.getframerate()
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        frames = handle.readframes(handle.getnframes())
    if width == 2:
        samples = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    elif width == 4:
        samples = np.frombuffer(frames, dtype="<i4").astype(np.float32) / 2147483648.0
    else:
        raise ValueError(f"unsupported sample width {width}")
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    return np.ascontiguousarray(samples), rate


def to_16k(samples: np.ndarray, rate: int) -> np.ndarray:
    if rate == 16000:
        return samples.astype(np.float32, copy=False)
    count = int(round(len(samples) * 16000 / rate))
    if count <= 1 or len(samples) <= 1:
        return np.zeros(max(count, 0), dtype=np.float32)
    src = np.linspace(0.0, 1.0, len(samples), endpoint=False)
    dst = np.linspace(0.0, 1.0, count, endpoint=False)
    return np.interp(dst, src, samples).astype(np.float32)


def normalize_syllable(word: str) -> str:
    letters: list[str] = []
    for ch in word.lower():
        if ch == "v" and "v" not in DICTIONARY and "u" in DICTIONARY:
            ch = "u"
        if len(ch) == 1 and ch.isalpha() and ch in DICTIONARY:
            letters.append(ch)
    if letters:
        return "".join(letters)
    # An empty token still needs one span so the character keeps its place.
    for fallback in ("a", "e", "i", "u"):
        if fallback in DICTIONARY:
            return fallback
    return ""


def align(chars: list[str], syllables: list[str], wav: bytes) -> list[dict]:
    if MODEL is None or TOKENIZER is None or ALIGNER is None:
        raise RuntimeError(LOAD_ERROR or "model is not loaded")
    samples, rate = read_wav(wav)
    samples = to_16k(samples, rate)
    if samples.size < 160:
        raise ValueError("audio is too short")
    words = [normalize_syllable(syllable) for syllable in syllables]
    if any(not word for word in words):
        raise ValueError("a syllable has no letters in the model dictionary")
    waveform = torch.from_numpy(samples).unsqueeze(0)
    with LOCK, torch.inference_mode():
        emission, _ = MODEL(waveform)
        tokens = TOKENIZER(words)
        token_spans = ALIGNER(emission[0], tokens)
    ratio = waveform.size(1) / emission.size(1)
    spans = []
    for index, word_spans in enumerate(token_spans):
        char = chars[index] if index < len(chars) else ""
        if not word_spans:
            spans.append({"char": char, "start": 0.0, "end": 0.0})
            continue
        start = float(word_spans[0].start * ratio / 16000)
        end = float(word_spans[-1].end * ratio / 16000)
        spans.append({"char": char, "start": start, "end": end})
    return spans


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        print(f"align {self.address_string()} {fmt % args}", flush=True)

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] != "/health":
            self._json(404, {"error": "not found"})
            return
        if MODEL is None:
            self._json(503, {"ok": False, "error": LOAD_ERROR or "loading"})
            return
        self._json(200, {"ok": True, "rssMb": round(rss_mb())})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] != "/align":
            self._json(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0 or length > MAX_BODY:
            self._json(413, {"error": "body too large"})
            return
        raw = self.rfile.read(length)
        try:
            body = json.loads(raw)
            syllables = body.get("syllables")
            chars = body.get("chars") or []
            audio = body.get("audioBase64") or ""
            if not isinstance(syllables, list) or not syllables:
                raise ValueError("syllables are required")
            if not isinstance(audio, str) or not audio:
                raise ValueError("audioBase64 is required")
            wav = base64.b64decode(audio)
            started = time.perf_counter()
            spans = align([str(ch) for ch in chars], [str(item) for item in syllables], wav)
            elapsed = time.perf_counter() - started
            print(
                f"aligned chars={len(spans)} sec={elapsed:.2f} rss_mb={rss_mb():.0f}",
                flush=True,
            )
            self._json(200, {"spans": spans, "seconds": round(elapsed, 3)})
        except Exception as err:  # noqa: BLE001 — the reader falls back when this fails
            print(f"align error: {err}", flush=True)
            self._json(500, {"error": "align failed"})


def main() -> None:
    load_model()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"listening on {PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
