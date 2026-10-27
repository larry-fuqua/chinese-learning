#!/usr/bin/env python3
"""Score the reader's aligner, pitch tracker, and tone grader separately.

Native speech is the THCHS-30 test partition (Apache 2.0). Phone times and
tone diacritics are the published anyspeech alignments shipped with
changelinglab/thchs30-segment. The phone set matches the Montreal Forced
Aligner Mandarin dictionary. THCHS-30 itself has no time stamps, and this
script does not re-run MFA.

Praat autocorrelation (parselmouth, floor 70 Hz, ceiling 500 Hz, 10 ms) is
the reference F0 tracker. The app is never modified.

Larry's recording under tests/fixtures/owner-take is alignment-only and is
excluded from every tone score and from the comparison classifier.
"""

from __future__ import annotations

import json
import subprocess
import wave
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import parselmouth
import pyarrow.parquet as pq
import soundfile as sf
from pypinyin import Style, pinyin
from sklearn.linear_model import LogisticRegression

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path("/tmp/eval-data")
ALIGN_PARQUET = CACHE / "align.parquet"
AUDIO_PARQUET = CACHE / "test-0.parquet"
WAV_DIR = CACHE / "wav"
RESULT_PATH = ROOT / "eval" / "results" / "metrics.json"
JOB_DIR = CACHE / "jobs"

ALIGN_MAX = 300
FULL_MAX = 64
PAUSE_GAP = 0.15
SR_SYN = 16000

VOWEL = set("aeiouyɑæəɚɛɪɔʊɤɵɨʉɐʌœø")
HIGH = set("iuyɪʊjwɥ")
CHAO = "˥˦˧˨˩"


def letters(phone: str) -> str:
    return "".join(ch for ch in phone if ch.isalpha() or ch in "ŋəɚɑɛɔʊɤɐ").replace("ː", "").replace("ˑ", "")


def is_vowel_phone(phone: str) -> bool:
    if phone == "[SIL]":
        return False
    if "̩" in phone:
        return True
    return any(ch in VOWEL for ch in phone)


def is_high(phone: str) -> bool:
    if "̩" in phone:
        return False
    base = letters(phone)
    return base in HIGH or (len(base) == 1 and base in HIGH)


def is_coda(phone: str) -> bool:
    if phone == "[SIL]" or "̩" in phone:
        return False
    return letters(phone) in {"n", "ŋ", "ɲ"}


def is_nucleus(phone: str, nxt: str | None) -> bool:
    if not is_vowel_phone(phone):
        return False
    if is_high(phone) and nxt is not None and is_vowel_phone(nxt):
        return False
    return True


def ipa_tone(nucleus: str) -> int:
    chao = "".join(ch for ch in nucleus if ch in CHAO)
    if "˧˩˧" in chao or "˨˩˦" in chao:
        return 3
    if "˧˥" in chao or "˨˥" in chao:
        return 2
    if "˥˩" in chao or "˦˩" in chao:
        return 4
    if chao in {"˥", "˦", "˥˥", "˦˦"}:
        return 1
    if not chao:
        return 5
    return 0


def hanzi_of(word: str) -> str:
    return "".join(ch for ch in word if "\u4e00" <= ch <= "\u9fff")


def nuclei_spans(phones, starts, ends, idxs):
    nuc = []
    for k, i in enumerate(idxs):
        nxt = phones[idxs[k + 1]] if k + 1 < len(idxs) else None
        if is_nucleus(phones[i], nxt):
            nuc.append(i)
    if not nuc:
        return []
    idxset = set(idxs)
    spans = []
    for n_i, ni in enumerate(nuc):
        if n_i == 0:
            start_i = idxs[0]
        else:
            prev = nuc[n_i - 1]
            j = prev + 1
            while j < ni and j in idxset and is_coda(phones[j]):
                j += 1
            start_i = j
        end_i = ni
        j = ni + 1
        next_n = nuc[n_i + 1] if n_i + 1 < len(nuc) else None
        while j < len(phones) and j in idxset and (next_n is None or j < next_n) and is_coda(phones[j]):
            end_i = j
            j += 1
        spans.append((float(starts[start_i]), float(ends[end_i]), phones[ni]))
    return spans


def word_phone_indexes(phones, starts, w0, w1):
    return [i for i, (phone, start) in enumerate(zip(phones, starts)) if phone != "[SIL]" and w0 - 0.02 <= start < w1 - 0.001]


def load_references() -> list[dict]:
    table = pq.read_table(
        ALIGN_PARQUET,
        columns=["id", "phones", "start", "end", "words", "word_start", "word_end"],
    )
    ids = table.column("id").to_pylist()
    phones = table.column("phones").to_pylist()
    starts = table.column("start").to_pylist()
    ends = table.column("end").to_pylist()
    words = table.column("words").to_pylist()
    wstarts = table.column("word_start").to_pylist()
    wends = table.column("word_end").to_pylist()
    utts = []
    for i, utt in enumerate(ids):
        if not str(utt).startswith("D"):
            continue
        chars = []
        bounds = []
        tones = []
        kept = True
        for word, w0, w1 in zip(words[i], wstarts[i], wends[i]):
            if word == "[SIL]":
                continue
            hz = hanzi_of(word)
            if not hz:
                continue
            idxs = word_phone_indexes(phones[i], starts[i], w0, w1)
            spans = nuclei_spans(phones[i], starts[i], ends[i], idxs)
            if len(spans) != len(hz):
                kept = False
                break
            for ch, (a, b, nucleus) in zip(hz, spans):
                if not (b > a):
                    kept = False
                    break
                chars.append(ch)
                bounds.append([a, b])
                tones.append(ipa_tone(nucleus))
            if not kept:
                break
        if not kept or len(chars) < 4:
            continue
        dur = float(ends[i][-1]) if ends[i] else 0.0
        if not (1.5 <= dur <= 16):
            continue
        utts.append(
            {
                "id": utt,
                "speaker": utt.split("_")[0],
                "text": "".join(chars),
                "bounds": bounds,
                "tones": tones,
                "duration": dur,
            }
        )
    return utts


def choose(utts: list[dict]) -> tuple[list[dict], list[dict]]:
    by = defaultdict(list)
    for utt in sorted(utts, key=lambda item: item["id"]):
        by[utt["speaker"]].append(utt)
    picked = []
    while len(picked) < ALIGN_MAX:
        grew = False
        for speaker in sorted(by):
            if not by[speaker]:
                continue
            picked.append(by[speaker].pop(0))
            grew = True
            if len(picked) >= ALIGN_MAX:
                break
        if not grew:
            break
    return picked, picked[:FULL_MAX]


def insert_pauses(chars: list[str], bounds: list[list[float]]) -> tuple[str, list[list[float]]]:
    graph: list[str] = []
    times: list[list[float]] = []
    for i, (ch, span) in enumerate(zip(chars, bounds)):
        if i and span[0] - bounds[i - 1][1] > PAUSE_GAP:
            graph.append("，")
            times.append([bounds[i - 1][1], span[0]])
        graph.append(ch)
        times.append([span[0], span[1]])
    return "".join(graph), times


def citation_pinyin(text: str) -> list[str]:
    marks = []
    for ch in text:
        if not ("\u4e00" <= ch <= "\u9fff"):
            continue
        marks.append(pinyin(ch, style=Style.TONE)[0][0])
    return marks


def praat_track(path: Path) -> list[dict]:
    sound = parselmouth.Sound(str(path))
    pitch = sound.to_pitch(time_step=0.01, pitch_floor=70.0, pitch_ceiling=500.0)
    times = pitch.xs()
    freq = pitch.selected_array["frequency"]
    frames = []
    for t, hz in zip(times, freq):
        value = float(hz)
        frames.append({"t": float(t), "hz": None if value <= 0 else value})
    return frames


def write_wav(path: Path, samples: np.ndarray, sr: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), samples.astype(np.float32), sr, subtype="PCM_16")


def extract_audio(wanted: set[str]) -> None:
    WAV_DIR.mkdir(parents=True, exist_ok=True)
    missing = {utt for utt in wanted if not (WAV_DIR / f"{utt}.wav").exists()}
    if not missing:
        return
    pf = pq.ParquetFile(AUDIO_PARQUET)
    found = set()
    for batch in pf.iter_batches(batch_size=16, columns=["utt_id", "audio"]):
        ids = batch.column("utt_id").to_pylist()
        audios = batch.column("audio").to_pylist()
        for utt, audio in zip(ids, audios):
            if utt not in missing:
                continue
            (WAV_DIR / f"{utt}.wav").write_bytes(audio["bytes"])
            found.add(utt)
        if found == missing:
            break
    absent = missing - found
    if absent:
        raise SystemExit(f"missing audio for {len(absent)} utterances, e.g. {next(iter(absent))}")


def run_bridge(jobs: list[dict], name: str) -> list[dict]:
    JOB_DIR.mkdir(parents=True, exist_ok=True)
    src = JOB_DIR / f"{name}-jobs.json"
    dst = JOB_DIR / f"{name}-out.json"
    src.write_text(json.dumps(jobs))
    subprocess.run(
        ["node", "--import", "tsx", "eval/bridge.ts", str(src), str(dst)],
        cwd=ROOT,
        check=True,
    )
    return json.loads(dst.read_text())


def job_for(utt: dict, tier: str, praat: list[dict] | None = None) -> dict:
    graph, graph_times = insert_pauses(list(utt["text"]), utt["bounds"])
    job = {
        "id": utt["id"],
        "wav": str(WAV_DIR / f"{utt['id']}.wav"),
        "pcm": "wav",
        "text": utt["text"],
        "pinyin": citation_pinyin(utt["text"]),
        "reference": utt["bounds"],
        "tokens": utt["tokens"],
        "graphText": graph,
        "graphTimes": graph_times,
        "ipaTone": utt["tones"],
        "tier": tier,
    }
    if praat is not None:
        job["praat"] = praat
    return job


def synth_sentence() -> dict:
    rng = np.random.default_rng(0)
    sr = SR_SYN
    pieces = []
    bounds = []
    cursor = 0.0

    def add_silence(dur: float) -> None:
        nonlocal cursor
        pieces.append(np.zeros(int(dur * sr), dtype=np.float32))
        cursor += dur

    def add_syllable(kind: str, dur: float, f0_of) -> None:
        nonlocal cursor
        n = int(dur * sr)
        tt = np.arange(n) / sr
        f0 = np.asarray(f0_of(tt, dur), dtype=np.float64)
        phase = 2 * np.pi * np.cumsum(f0) / sr
        y = np.zeros(n, dtype=np.float64)
        first = 2 if kind == "missing" else 1
        for h in range(first, 8):
            y += np.sin(h * phase) / h
        env = np.ones(n)
        a = max(2, int(0.012 * sr))
        b = max(2, int(0.02 * sr))
        env[:a] = np.linspace(0, 1, a)
        env[-b:] = np.linspace(1, 0, b)
        y *= 0.28 * env
        noise_n = int(0.028 * sr)
        y[:noise_n] += rng.normal(0, 0.05, noise_n)
        pieces.append(y.astype(np.float32))
        bounds.append([cursor, cursor + dur])
        cursor += dur

    add_silence(0.12)
    specs = [
        ("t1", 0.26, lambda t, d: np.full_like(t, 200.0), 1),
        ("t2", 0.26, lambda t, d: 145.0 + 130.0 * (t / d), 2),
        ("t3", 0.30, lambda t, d: 190.0 - 70.0 * np.sin(np.pi * np.clip(t / d, 0, 1)), 3),
        ("t4", 0.24, lambda t, d: 300.0 - 160.0 * (t / d), 4),
    ]
    chars = []
    tones = []
    for name, dur, fn, tone in specs:
        if chars:
            add_silence(0.11)
        add_syllable(name, dur, fn)
        chars.append("妈麻马骂"[tone - 1])
        tones.append(tone)
    add_silence(0.12)
    audio = np.concatenate(pieces)
    path = WAV_DIR / "syn-sentence.wav"
    write_wav(path, audio, sr)
    return {
        "id": "syn-sentence",
        "text": "".join(chars),
        "bounds": bounds,
        "tokens": [span[:] for span in bounds],
        "tones": tones,
        "pinyin": ["mā", "má", "mǎ", "mà"],
        "wav": str(path),
    }


def synth_probe(name: str, f0_of, harmonics, tone: int, dur: float = 0.28) -> dict:
    sr = SR_SYN
    n = int(dur * sr)
    tt = np.arange(n) / sr
    f0 = np.asarray(f0_of(tt, dur), dtype=np.float64)
    phase = 2 * np.pi * np.cumsum(f0) / sr
    y = np.zeros(n, dtype=np.float64)
    for h in harmonics:
        y += np.sin(h * phase) / h
    env = np.ones(n)
    a = int(0.01 * sr)
    env[:a] = np.linspace(0, 1, a)
    y *= 0.3 * env
    pad = np.zeros(int(0.08 * sr), dtype=np.float32)
    audio = np.concatenate([pad, y.astype(np.float32), pad])
    path = WAV_DIR / f"{name}.wav"
    write_wav(path, audio, sr)
    start = 0.08
    return {
        "id": name,
        "text": "妈" if tone == 1 else "麻",
        "bounds": [[start, start + dur]],
        "tokens": [[start, start + dur]],
        "tones": [tone],
        "pinyin": ["mā" if tone == 1 else "má"],
        "wav": str(path),
    }


def window_pairs(item: dict, key: str) -> list[list[float]] | None:
    windows = (item.get("windows") or {}).get(key)
    if not isinstance(windows, list):
        return None
    return windows


def boundary_summary(rows: list[dict]) -> dict:
    if not rows:
        return {"n": 0}
    start = np.array([row["ds"] for row in rows], dtype=float)
    end = np.array([row["de"] for row in rows], dtype=float)
    both = np.maximum(np.abs(start), np.abs(end))
    return {
        "n": int(len(rows)),
        "missRate": round(float(np.mean([row["miss"] for row in rows])), 3),
        "medianAbsStartMs": round(float(np.median(np.abs(start))), 1),
        "medianAbsEndMs": round(float(np.median(np.abs(end))), 1),
        "medianSignedStartMs": round(float(np.median(start)), 1),
        "medianSignedEndMs": round(float(np.median(end)), 1),
        "p90MaxEdgeMs": round(float(np.percentile(both, 90)), 1),
        "within50Ms": round(float(np.mean(both <= 50)), 3),
        "within100Ms": round(float(np.mean(both <= 100)), 3),
        "medianBleedMs": round(float(np.median([row["bleed"] for row in rows])), 1),
        "medianIou": round(float(np.median([row["iou"] for row in rows])), 3),
    }


def edge_rows(hyp: list[list[float]], ref: list[list[float]]) -> list[dict]:
    rows = []
    n = min(len(hyp), len(ref))
    for i in range(n):
        rs, re = ref[i]
        hs, he = hyp[i] if hyp[i] else (0.0, 0.0)
        ref_dur = re - rs
        hyp_dur = he - hs
        overlap = max(0.0, min(re, he) - max(rs, hs))
        union = max(re, he) - min(rs, hs)
        iou = overlap / union if union > 0 else 0.0
        miss = hyp_dur < 0.02 or (ref_dur > 0 and overlap / ref_dur < 0.2)
        bleed = 0.0
        for j in (i - 1, i + 1):
            if j < 0 or j >= len(ref):
                continue
            os_, oe = ref[j]
            bleed += max(0.0, min(he, oe) - max(hs, os_)) * 1000
        rows.append(
            {
                "ds": (hs - rs) * 1000,
                "de": (he - re) * 1000,
                "miss": miss,
                "bleed": bleed,
                "iou": iou,
            }
        )
    return rows


def confusion(pairs: list[tuple[int, int | None]]) -> dict:
    labels = [1, 2, 3, 4]
    matrix = {str(true): {str(pred): 0 for pred in labels + ["none"]} for true in labels}
    for true, pred in pairs:
        if true not in labels:
            continue
        key = str(pred) if pred in labels else "none"
        matrix[str(true)][key] += 1
    scored = [item for item in pairs if item[0] in labels]
    correct = sum(1 for true, pred in scored if pred == true)
    per = {}
    for tone in labels:
        subset = [item for item in scored if item[0] == tone]
        per[str(tone)] = {
            "n": len(subset),
            "recall": round(sum(1 for true, pred in subset if pred == true) / len(subset), 3) if subset else None,
        }
    return {
        "n": len(scored),
        "accuracy": round(correct / len(scored), 3) if scored else None,
        "matrix": matrix,
        "perTone": per,
    }


def verdict_rates(items: list[dict], truth_key: str, verdict_key: str) -> dict:
    usable = [item for item in items if item.get(truth_key) in (1, 2, 3, 4)]
    match = [item for item in usable if "shape matches" in (item.get(verdict_key) or "")]
    off = [item for item in usable if "shape is off" in (item.get(verdict_key) or "")]
    unclear = [item for item in usable if "no clear pitch" in (item.get(verdict_key) or "")]
    # False match: the written line says the expected tone matches, but the
    # argmax class is a different tone. Expected here is the true tone.
    false_match = [
        item
        for item in match
        if item.get("pred") not in (None, item.get(truth_key))
    ]
    forced = []
    blocked = 0
    for item in usable:
        true = item[truth_key]
        for tone, verdict in (item.get("verdictIf") or {}).items():
            if int(tone) == true:
                continue
            is_match = "shape matches" in verdict
            forced.append(is_match)
            if is_match:
                continue
            # Shape override is the only way a p>=0.25 wrong tone is rejected
            # when the two tones are 2 and 4. Count those saves separately.
        if item.get("pIpa") is not None and item["pIpa"] >= 0.25 and item.get("shape") in (2, 4):
            if true in (2, 4) and item["shape"] != true and "shape is off" in (item.get(verdict_key) or ""):
                blocked += 1
    return {
        "n": len(usable),
        "matchRate": round(len(match) / len(usable), 3) if usable else None,
        "offRate": round(len(off) / len(usable), 3) if usable else None,
        "unclearRate": round(len(unclear) / len(usable), 3) if usable else None,
        "matchButArgmaxWrong": round(len(false_match) / len(usable), 3) if usable else None,
        "falseMatchWhenExpectedIsWrong": round(sum(forced) / len(forced), 3) if forced else None,
        "nForced": len(forced),
        "oppositeShapeBlockedAMatch": blocked,
    }


def grade_pairs(results: list[dict], grade_key: str, truth: str = "ipa") -> list[tuple[int, int | None]]:
    pairs = []
    for item in results:
        grades = (item.get("grades") or {}).get(grade_key) or []
        for grade in grades:
            label = grade.get(truth)
            if label not in (1, 2, 3, 4):
                continue
            pairs.append((int(label), grade.get("pred")))
    return pairs


def collect_grades(results: list[dict], grade_key: str) -> list[dict]:
    rows = []
    for item in results:
        speaker = item["id"].split("_")[0] if "_" in item["id"] else item["id"]
        for index, grade in enumerate((item.get("grades") or {}).get(grade_key) or []):
            row = dict(grade)
            row["speaker"] = speaker
            row["utt"] = item["id"]
            row["i"] = index
            rows.append(row)
    return rows


def pitch_metrics(results: list[dict], praat_by_id: dict[str, list[dict]]) -> dict:
    both = []
    app_v = []
    praat_v = []
    high = []
    inside = []
    for item in results:
        track = item.get("pitch")
        praat = praat_by_id.get(item["id"])
        ref = item.get("reference")
        if not track or not praat or not ref:
            continue
        pt = np.array([frame["t"] for frame in praat], dtype=float)
        ph = np.array([np.nan if frame["hz"] is None else frame["hz"] for frame in praat], dtype=float)
        if not len(pt):
            continue
        for t, hz in zip(track["t"], track["hz"]):
            in_syl = any(span[0] <= t <= span[1] for span in ref)
            if not in_syl:
                continue
            inside.append(1)
            j = int(np.argmin(np.abs(pt - t)))
            if abs(pt[j] - t) > 0.02:
                continue
            p_hz = ph[j]
            p_voiced = np.isfinite(p_hz) and p_hz > 0
            a_voiced = hz is not None and hz > 0
            app_v.append(a_voiced)
            praat_v.append(p_voiced)
            if p_voiced and p_hz > 400:
                high.append(1)
            else:
                high.append(0)
            if a_voiced and p_voiced:
                both.append((float(hz), float(p_hz)))
    if not praat_v:
        return {"nFrames": 0}
    app_v = np.array(app_v)
    praat_v = np.array(praat_v)
    ratios = np.array([a / p for a, p in both], dtype=float) if both else np.array([])
    semis = 12 * np.log2(ratios) if len(ratios) else np.array([])
    gpe = np.abs(ratios - 1) > 0.20 if len(ratios) else np.array([])
    octave = np.abs(np.abs(semis) - 12) < 1.5 if len(semis) else np.array([])
    fine = np.abs(semis) < 1.0 if len(semis) else np.array([])
    return {
        "nFramesInsideSyllable": int(len(praat_v)),
        "nBothVoiced": int(len(both)),
        "voicingRecall": round(float(np.mean(app_v[praat_v])), 3) if praat_v.any() else None,
        "voicingFalseAlarm": round(float(np.mean(app_v[~praat_v])), 3) if (~praat_v).any() else None,
        "voicingDisagreement": round(float(np.mean(app_v != praat_v)), 3),
        "grossPitchError": round(float(np.mean(gpe)), 3) if len(gpe) else None,
        "octaveError": round(float(np.mean(octave)), 3) if len(octave) else None,
        "within1Semitone": round(float(np.mean(fine)), 3) if len(fine) else None,
        "medianAbsSemitone": round(float(np.median(np.abs(semis))), 2) if len(semis) else None,
        "praatAbove400Hz": round(float(np.mean(high)), 3) if high else None,
    }


def half_third(results: list[dict], praat_by_id: dict[str, list[dict]]) -> dict:
    deltas = []
    called = Counter()
    for item in results:
        praat = praat_by_id.get(item["id"])
        grades = (item.get("grades") or {}).get("oracle") or []
        ref = item.get("reference") or []
        if not praat or not grades:
            continue
        pt = np.array([frame["t"] for frame in praat])
        ph = np.array([np.nan if frame["hz"] is None else frame["hz"] for frame in praat])
        for grade, span in zip(grades, ref):
            if grade.get("ipa") != 3 or not (span[1] > span[0]):
                continue
            called[grade.get("pred")] += 1
            mask = (pt >= span[0]) & (pt <= span[1]) & np.isfinite(ph)
            if mask.sum() < 4:
                continue
            times = pt[mask]
            hz = ph[mask]
            cut = span[0] + 0.18 * (span[1] - span[0])
            early = hz[times < cut]
            late = hz[times >= cut]
            if len(early) < 2 or len(late) < 2:
                continue
            deltas.append(12 * np.log2(np.median(late) / np.median(early)))
    n = sum(called.values())
    return {
        "n": n,
        "pred": {str(k): v for k, v in sorted(called.items(), key=lambda kv: str(kv[0]))},
        "recallAs3": round(called[3] / n, 3) if n else None,
        "nShape": len(deltas),
        "medianLateMinusEarlySemitone": round(float(np.median(deltas)), 2) if deltas else None,
        "fractionFallingMoreThan1st": round(float(np.mean(np.array(deltas) < -1)), 3) if deltas else None,
    }


def refit(rows: list[dict]) -> dict:
    usable = [row for row in rows if row.get("ipa") in (1, 2, 3, 4) and row.get("features")]
    by = defaultdict(list)
    for row in usable:
        by[row["speaker"]].append(row)
    speakers = sorted(by)
    held = [speaker for speaker in speakers if len(by[speaker]) >= 40][-2:]
    if len(held) < 2:
        return {"error": "not enough speakers", "speakers": {sp: len(rows_) for sp, rows_ in by.items()}}
    train = [row for row in usable if row["speaker"] not in held]
    test = [row for row in usable if row["speaker"] in held]
    clf = LogisticRegression(max_iter=2000, C=1.0)
    clf.fit([row["features"] for row in train], [row["ipa"] for row in train])
    pred = clf.predict([row["features"] for row in test])
    labels = [row["ipa"] for row in test]
    majority = Counter(row["ipa"] for row in train).most_common(1)[0][0]
    app = [row.get("pred") for row in test]
    return {
        "heldOutSpeakers": held,
        "nTrain": len(train),
        "nTest": len(test),
        "majorityBaseline": round(sum(label == majority for label in labels) / len(labels), 3),
        "appModel": round(sum(p == y for p, y in zip(app, labels)) / len(labels), 3),
        "refitOnNative": round(sum(int(p) == y for p, y in zip(pred, labels)) / len(labels), 3),
        "confusionRefit": confusion(list(zip(labels, [int(p) for p in pred])))["matrix"],
    }


def shape_accuracy(rows: list[dict]) -> dict:
    pairs = [(row["ipa"], row.get("shape")) for row in rows if row.get("ipa") in (1, 2, 3, 4)]
    return confusion(pairs)


def row_file_metrics(path: Path) -> dict:
    groups = json.loads(path.read_text())
    out = {}
    for kind, split, ws in (
        ("human", "heldout", "fa"),
        ("human", "heldout", "cur"),
        ("ai", "heldout", "fa"),
        ("ai", "tune", "fa"),
    ):
        items = []
        for group in groups:
            if group["kind"] == kind and group["split"] == split and group["ws"] == ws:
                items.extend(group["items"])
        pairs = [(item["exp"], item["pred"]) for item in items if item["exp"] in (1, 2, 3, 4)]
        shape_pairs = [(item["exp"], item["shape"]) for item in items if item["exp"] in (1, 2, 3, 4)]
        out[f"{kind}-{split}-{ws}"] = {
            "argmax": confusion(pairs),
            "shapeRule": confusion(shape_pairs),
            "verdict": verdict_rates(
                [{"ipa": item["exp"], "pred": item["pred"], "verdictIpa": item["verdict"], "verdictIf": item["verdictIf"], "pIpa": item["pExpected"], "shape": item["shape"]} for item in items],
                "ipa",
                "verdictIpa",
            ),
        }
    return out


def main() -> None:
    WAV_DIR.mkdir(parents=True, exist_ok=True)
    RESULT_PATH.parent.mkdir(parents=True, exist_ok=True)
    print("loading references", flush=True)
    utts = load_references()
    print(f"grouped utterances {len(utts)}", flush=True)
    # Keep only utterances whose audio is in the downloaded test shard.
    have = set()
    pf = pq.ParquetFile(AUDIO_PARQUET)
    for batch in pf.iter_batches(batch_size=256, columns=["utt_id"]):
        have.update(batch.column("utt_id").to_pylist())
    utts = [utt for utt in utts if utt["id"] in have]
    align_set, full_set = choose(utts)
    for utt in align_set:
        utt["tokens"] = [span[:] for span in utt["bounds"]]
    print(f"align {len(align_set)} full {len(full_set)} speakers {len({u['speaker'] for u in align_set})}", flush=True)
    extract_audio({utt["id"] for utt in align_set})

    print("synthetic + praat", flush=True)
    sentence = synth_sentence()
    missing = synth_probe("syn-missing-f0", lambda t, d: 150 + 120 * (t / d), range(2, 8), 2)
    high = synth_probe("syn-high", lambda t, d: np.full_like(t, 460.0), range(1, 6), 1, dur=0.3)
    probes = [sentence, missing, high]
    praat_by_id = {}
    full_ids = {utt["id"] for utt in full_set}
    for utt in full_set:
        praat_by_id[utt["id"]] = praat_track(WAV_DIR / f"{utt['id']}.wav")
    for probe in probes:
        praat_by_id[probe["id"]] = praat_track(Path(probe["wav"]))

    align_jobs = [job_for(utt, "align") for utt in align_set if utt["id"] not in full_ids]
    full_jobs = []
    for utt in full_set:
        job = job_for(utt, "full", praat_by_id[utt["id"]])
        full_jobs.append(job)
    for probe in probes:
        full_jobs.append(
            {
                "id": probe["id"],
                "wav": probe["wav"],
                "pcm": "wav",
                "text": probe["text"],
                "pinyin": probe["pinyin"],
                "reference": probe["bounds"],
                "tokens": probe["tokens"],
                "graphText": probe["text"],
                "graphTimes": probe["bounds"],
                "ipaTone": probe["tones"],
                "tier": "full",
                "praat": praat_by_id[probe["id"]],
            }
        )

    print(f"bridge align {len(align_jobs)}", flush=True)
    align_out = run_bridge(align_jobs, "align") if align_jobs else []
    full_out = []
    chunk = 8
    for i in range(0, len(full_jobs), chunk):
        part = full_jobs[i : i + chunk]
        print(f"bridge full {i}-{i+len(part)}", flush=True)
        full_out.extend(run_bridge(part, f"full-{i}"))

    fixtures = fixture_jobs()
    if fixtures:
        print(f"bridge fixtures {len(fixtures)}", flush=True)
        for job in fixtures:
            praat_by_id[job["id"]] = praat_track(Path(job["wav"])) if job.get("pcm") != "f32" else praat_f32(job)
        # praat already attached inside fixture_jobs via a second pass
        fix_out = run_bridge(fixtures, "fixtures")
    else:
        fix_out = []

    owner = owner_job()
    print("bridge owner", flush=True)
    owner_out = run_bridge([owner], "owner")

    print("bridge tone-rows", flush=True)
    rows_out = CACHE / "tone-rows-out.json"
    subprocess.run(
        ["node", "--import", "tsx", "eval/bridge.ts", "--rows", str(ROOT / "scripts/data/tone-rows.json"), str(rows_out)],
        cwd=ROOT,
        check=True,
    )

    by_id = {}
    for item in align_out + full_out:
        if item.get("error"):
            print("job error", item["id"], item["error"])
            continue
        ref = next((utt["bounds"] for utt in align_set if utt["id"] == item["id"]), None)
        if ref is None:
            ref = next((probe["bounds"] for probe in probes if probe["id"] == item["id"]), None)
        item["reference"] = ref
        by_id[item["id"]] = item

    thchs_align = [by_id[utt["id"]] for utt in align_set if utt["id"] in by_id]
    thchs_full = [by_id[utt["id"]] for utt in full_set if utt["id"] in by_id]
    methods = ["tokens", "sliced", "faPost", "proportionalRaw", "proportional", "voiced"]
    alignment = {}
    for method in methods:
        rows = []
        for item in thchs_align if method != "voiced" else thchs_full:
            hyp = window_pairs(item, method)
            ref = item.get("reference")
            if not hyp or not ref:
                continue
            rows.extend(edge_rows(hyp, ref))
        alignment[method] = boundary_summary(rows)

    tone = {}
    for key in ("oracle", "sliced", "proportional", "voiced", "praat", "hybrid", "noskip"):
        tone[key] = confusion(grade_pairs(thchs_full, key))
    oracle_rows = collect_grades(thchs_full, "oracle")
    tone["verdictOracle"] = verdict_rates(oracle_rows, "ipa", "verdictIpa")
    tone["verdictOracleAgainstAppExpected"] = verdict_rates(oracle_rows, "spoken", "verdictSpoken")
    tone["verdictSliced"] = verdict_rates(collect_grades(thchs_full, "sliced"), "ipa", "verdictIpa")
    tone["shapeRuleOracle"] = shape_accuracy(oracle_rows)
    agree = [row for row in oracle_rows if row.get("ipa") == row.get("spoken") and row.get("ipa") in (1, 2, 3, 4)]
    tone["whereAppExpectedMatchesIpa"] = {
        "n": len(agree),
        "shareOfScored": round(len(agree) / max(1, sum(1 for row in oracle_rows if row.get("ipa") in (1, 2, 3, 4))), 3),
        "argmax": confusion([(row["ipa"], row.get("pred")) for row in agree]),
    }
    tone["refit"] = refit(oracle_rows)
    tone["refitOnSlicedContours"] = refit(collect_grades(thchs_full, "sliced"))

    syn = {}
    for probe in probes:
        item = by_id.get(probe["id"])
        if not item:
            continue
        syn[probe["id"]] = {
            "alignmentSliced": boundary_summary(edge_rows(window_pairs(item, "sliced") or [], probe["bounds"])),
            "alignmentProportional": boundary_summary(edge_rows(window_pairs(item, "proportionalRaw") or [], probe["bounds"])),
            "toneOracle": confusion(grade_pairs([item], "oracle")),
            "tonePraat": confusion(grade_pairs([item], "praat")),
            "toneNoskip": confusion(grade_pairs([item], "noskip")),
            "grades": (item.get("grades") or {}).get("oracle"),
        }

    fix_metrics = fixture_metrics(fix_out, praat_by_id)
    owner_metrics = {}
    if owner_out and not owner_out[0].get("error"):
        item = owner_out[0]
        ref = owner["reference"]
        owner_metrics = {
            "n": len(ref),
            "rawFaSpans": boundary_summary(edge_rows(owner["tokens"], ref)),
            "afterSlicer": boundary_summary(edge_rows(window_pairs(item, "sliced") or [], ref)),
            "note": "Held-out hand bounds for one learner take. Not used for tone scores or the refit.",
        }

    pitch = pitch_metrics(thchs_full, praat_by_id)
    third = half_third(thchs_full, praat_by_id)
    stored = row_file_metrics(rows_out)

    tone_counts = Counter(tone for utt in full_set for tone in utt["tones"])
    metrics = {
        "corpus": {
            "name": "THCHS-30 test speakers (D*), audio from changelinglab/thchs30-segment, alignments from anyspeech/THCHS-30-alignments",
            "license": "Apache-2.0",
            "referenceAligner": "Published phone alignments. Phone inventory (IPA, Chao tone, length marks such as ː and ˘) matches the Montreal Forced Aligner Mandarin dictionary. MFA was not re-run here. Utterances whose phones did not split into one syllable per character were dropped.",
            "referencePitch": "Praat autocorrelation via parselmouth. time_step=0.01, floor=70 Hz, ceiling=500 Hz.",
            "groupedUtterancesInShard": len(utts),
            "alignmentUtterances": len(thchs_align),
            "pitchAndToneUtterances": len(thchs_full),
            "alignmentCharacters": alignment.get("sliced", {}).get("n"),
            "speakersFull": sorted({utt["speaker"] for utt in full_set}),
            "ipaToneCountsFull": {str(k): v for k, v in sorted(tone_counts.items())},
            "excluded": "tests/fixtures/owner-take is alignment-only. No threshold or weight was fit on it.",
        },
        "alignment": alignment,
        "pitch": pitch,
        "tone": tone,
        "tone3Surface": third,
        "synthetic": syn,
        "appFixtures": fix_metrics,
        "ownerTakeAlignment": owner_metrics,
        "storedContours": stored,
    }
    RESULT_PATH.write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {RESULT_PATH}", flush=True)


def praat_f32(job: dict) -> list[dict]:
    samples = np.fromfile(job["wav"], dtype="<f4")
    tmp = WAV_DIR / f"{job['id']}.wav"
    write_wav(tmp, samples, int(job["sampleRate"]))
    return praat_track(tmp)


def fixture_jobs() -> list[dict]:
    jobs = []
    known = {
        "果果今年十三岁，是一名中学生，读中学一年级。": [
            ("果果", "Guǒguo"),
            ("今年", "jīnnián"),
            ("十三", "shísān"),
            ("岁", "suì"),
            ("是", "shì"),
            ("一名", "yì míng"),
            ("中学生", "zhōngxuéshēng"),
            ("读", "dú"),
            ("中学", "zhōngxué"),
            ("一年级", "yì nián jí"),
        ]
    }
    directory = ROOT / "tests" / "fixtures" / "slice"
    for meta_path in sorted(directory.glob("*.json")):
        meta = json.loads(meta_path.read_text())
        windows = meta.get("windows_owned") or []
        text = "".join(item[0] for item in windows)
        bounds = [[item[1], item[2]] for item in windows]
        if known.get(meta.get("text")):
            marks = []
            for hanzi, py in known[meta["text"]]:
                # One stored syllable string per character, matching the app's splitter input.
                parts = py.split()
                if len(parts) == len(hanzi):
                    marks.extend(parts)
                elif len(hanzi) == 1:
                    marks.append(py)
                else:
                    marks.extend(citation_pinyin(hanzi) if len(parts) != len(hanzi) else parts)
            if len(marks) != len(text):
                marks = citation_pinyin(text)
        else:
            marks = citation_pinyin(text)
        pcm = meta_path.with_suffix(".f32")
        if not pcm.exists():
            continue
        wav = WAV_DIR / f"fix-{meta_path.stem}.wav"
        samples = np.fromfile(pcm, dtype="<f4")
        write_wav(wav, samples, int(meta["sampleRate"]))
        jobs.append(
            {
                "id": f"fix-{meta_path.stem}",
                "wav": str(wav),
                "pcm": "wav",
                "sampleRate": int(meta["sampleRate"]),
                "text": text,
                "pinyin": marks,
                "reference": bounds,
                "tokens": bounds,
                "ipaTone": [0] * len(text),
                "tier": "full",
                "praat": praat_track(wav),
            }
        )
    return jobs


def fixture_metrics(results: list[dict], praat_by_id: dict[str, list[dict]]) -> dict:
    rows = []
    for item in results:
        if item.get("error"):
            rows.append({"id": item["id"], "error": item["error"]})
            continue
        grades = (item.get("grades") or {}).get("oracle") or []
        scored = [grade for grade in grades if grade.get("spoken") in (1, 2, 3, 4)]
        match = sum(1 for grade in scored if "shape matches" in (grade.get("verdictSpoken") or ""))
        off = sum(1 for grade in scored if "shape is off" in (grade.get("verdictSpoken") or ""))
        argmax = sum(1 for grade in scored if grade.get("pred") == grade.get("spoken"))
        rows.append(
            {
                "id": item["id"],
                "n": len(scored),
                "argmaxVsAppExpected": round(argmax / len(scored), 3) if scored else None,
                "verdictMatch": round(match / len(scored), 3) if scored else None,
                "verdictOff": round(off / len(scored), 3) if scored else None,
                "pitch": pitch_metrics([{**item, "reference": item.get("windows", {}).get("tokens")}], {item["id"]: praat_by_id.get(item["id"], [])}),
            }
        )
    return {"note": "24 kHz fixtures used by the pitch tests, including the clip the tests call the AI voice. Windows are the fixture's own slices, so this is not an alignment score. Gold is the app's sandhi-adjusted pinyin, i.e. the tone the UI expects.", "clips": rows}


def owner_job() -> dict:
    fixture = json.loads((ROOT / "tests/fixtures/owner-take/fixture.json").read_text())
    text = "".join(ch for ch in fixture["text"] if "\u4e00" <= ch <= "\u9fff")
    tokens = [[span["start"], span["end"]] for span in fixture["spans"]]
    reference = [list(span) for span in fixture["bounds"]]
    # Punctuation keeps the pause path. Times for hanzi are the sidecar spans.
    graph = []
    graph_times = []
    han_i = 0
    raw = fixture["text"]
    placed = []
    for ch in raw:
        if "\u4e00" <= ch <= "\u9fff":
            placed.append((ch, tokens[han_i]))
            han_i += 1
        else:
            placed.append((ch, None))
    for i, (ch, span) in enumerate(placed):
        if span is not None:
            graph.append(ch)
            graph_times.append(span)
            continue
        prev = next((placed[j][1][1] for j in range(i - 1, -1, -1) if placed[j][1]), 0.0)
        nxt = next((placed[j][1][0] for j in range(i + 1, len(placed)) if placed[j][1]), prev)
        graph.append(ch)
        graph_times.append([prev, max(prev, nxt)])
    wav = WAV_DIR / "owner-take.wav"
    # Copy so Praat is not required; alignment only, but the bridge reads the wav.
    source = ROOT / "tests/fixtures/owner-take/take.wav"
    wav.write_bytes(source.read_bytes())
    return {
        "id": "owner-take",
        "wav": str(wav),
        "pcm": "wav",
        "text": text,
        "pinyin": citation_pinyin(text),
        "reference": reference,
        "tokens": tokens,
        "graphText": "".join(graph),
        "graphTimes": graph_times,
        "ipaTone": [0] * len(text),
        "tier": "align",
    }


if __name__ == "__main__":
    main()
