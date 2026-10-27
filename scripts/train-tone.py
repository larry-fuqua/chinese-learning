#!/usr/bin/env python3
"""Train the spoken-tone checker on native speech and write src/lib/tone-model.json.

The fit uses only the app's AI voice on the tune split (forced-alignment
windows). AISHELL-3 and the remaining AI clips are held out. Clips in
split tune_text_1.0 are the tune texts at another speed and are not held-out
scores (that would leak the text).

EXCLUDED FROM TRAINING AND TUNING.
tests/fixtures/owner-take is the owner's real recording of sentence
884d6d9a in story b9bee742. It is a timing/segmentation fixture only.
The learner is a beginner; this script must never fit weights or pick
thresholds on that take, or on any row that mentions it.
Per-character practice takes under DATA_DIR are learner recordings too.
This script reads only scripts/data/tone-rows.json and must not train on them.
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(__file__).resolve().parent / "data" / "tone-rows.json"
OUT = ROOT / "src" / "lib" / "tone-model.json"

# Owner-take identifiers. A row that contains any of these is refused.
BANNED = ("884d6d9a", "b9bee742", "owner-take")


def row_is_owner_take(row: dict) -> bool:
    blob = json.dumps(row, ensure_ascii=False)
    return any(token in blob for token in BANNED)


def feats(row: dict, prev: float | None) -> list[float] | None:
    raw = [v for v in row["c3"] if v is not None]
    if len(raw) < 4:
        return None
    c = np.array(raw, dtype=float)
    k = max(0.8, min(1.6, row["range"] / 8))
    c = c / k
    seg = [
        c[int(len(c) * i / 5) : max(int(len(c) * (i + 1) / 5), int(len(c) * i / 5) + 1)].mean()
        for i in range(5)
    ]
    x = np.arange(len(c))
    slope = float(np.polyfit(x / len(c), c, 1)[0])
    curv = float(np.polyfit(x / len(c), c, 2)[0])
    ph = 0.0 if prev is None else prev
    return [float(v) for v in seg] + [
        float(c.mean()),
        slope,
        curv,
        float(c.mean() - ph),
        float(min(row["dur"], 0.5)),
    ]


def scaled_mean(row: dict) -> float | None:
    raw = [v for v in row["c3"] if v is not None]
    if not raw:
        return None
    k = max(0.8, min(1.6, row["range"] / 8))
    return float(np.mean(raw) / k)


def build(rows: list[dict], ws: str) -> list[tuple[dict, list[float], float]]:
    byid: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        if row["ws"] == ws:
            byid[row["id"]].append(row)
    out: list[tuple[dict, list[float], float]] = []
    for group in byid.values():
        group.sort(key=lambda row: row["i"])
        prev: float | None = None
        for row in group:
            feature = feats(row, prev)
            used_prev = 0.0 if prev is None else prev
            nxt = scaled_mean(row)
            if nxt is not None:
                prev = nxt
            if feature is not None and row["exp"] in (1, 2, 3, 4):
                out.append((row, feature, used_prev))
    return out


def main() -> None:
    # The fixture directory is not a training input. Refuse it if a path ever points there.
    assert "owner-take" not in str(DATA), DATA
    assert DATA.name == "tone-rows.json"
    rows = json.loads(DATA.read_text())
    leaked = [row.get("id") for row in rows if row_is_owner_take(row)]
    assert leaked == [], (
        "The owner take is a timing fixture only and must not be used to train "
        f"or tune the tone checker: {leaked}"
    )
    usable = [row for row in rows if not row_is_owner_take(row)]
    assert len(usable) == len(rows)

    data = build(usable, "fa")
    train = [(row, feature, prev) for row, feature, prev in data if row["kind"] == "ai" and row["split"] == "tune"]
    assert train, "tune split is empty"
    assert all(row["split"] != "tune_text_1.0" for row, _, _ in train)
    assert all(not row_is_owner_take(row) for row, _, _ in train)

    clf = LogisticRegression(max_iter=2000, C=1.0)
    clf.fit([feature for _, feature, _ in train], [row["exp"] for row, _, _ in train])
    classes = [int(c) for c in clf.classes_]

    def score(name: str, sel) -> dict:
        chosen = [(row, feature) for row, feature, _ in data if sel(row)]
        pred = clf.predict([feature for _, feature in chosen])
        proba = clf.predict_proba([feature for _, feature in chosen])
        acc = float(np.mean([p == row["exp"] for (row, _), p in zip(chosen, pred)]))
        base = float(np.mean([row["cur"] == row["exp"] for row, _ in chosen]))
        accept = float(
            np.mean(
                [
                    pr[classes.index(row["exp"])] >= 0.25
                    for (row, _), pr in zip(chosen, proba)
                ]
            )
        )
        wrong = float(
            np.mean(
                [
                    pr[classes.index(tone)] >= 0.25
                    for (row, _), pr in zip(chosen, proba)
                    for tone in (1, 2, 3, 4)
                    if tone != row["exp"]
                ]
            )
        )
        print(
            f"{name:16s} n={len(chosen):4d} deployed={100 * base:5.1f} "
            f"learned={100 * acc:5.1f} accept-correct={100 * accept:5.1f} "
            f"accept-wrong={100 * wrong:5.1f}"
        )
        return {
            "n": len(chosen),
            "deployed": round(100 * base, 1),
            "learned": round(100 * acc, 1),
            "acceptCorrect": round(100 * accept, 1),
            "acceptWrong": round(100 * wrong, 1),
        }

    heldout = {
        "aiTune": score("ai tune", lambda row: row["kind"] == "ai" and row["split"] == "tune"),
        "aiHeldout": score("ai heldout", lambda row: row["kind"] == "ai" and row["split"] == "heldout"),
        "humanHeldout": score("human heldout", lambda row: row["kind"] == "human"),
    }

    checks = []
    seen = set()
    for row, feature, prev in data:
        key = (row["kind"], row["split"])
        if key in seen:
            continue
        if len(checks) >= 4:
            break
        seen.add(key)
        pr = clf.predict_proba([feature])[0]
        checks.append(
            {
                "id": row["id"],
                "c3": row["c3"],
                "range": row["range"],
                "dur": row["dur"],
                "prev": prev,
                "x": feature,
                "proba": [float(v) for v in pr],
            }
        )

    payload = {
        "classes": classes,
        "coef": clf.coef_.tolist(),
        "intercept": [float(v) for v in clf.intercept_],
        "acceptAt": 0.25,
        "featureNames": ["seg0", "seg1", "seg2", "seg3", "seg4", "mean", "slope", "curv", "prev", "dur"],
        "trainedOn": "ws=fa kind=ai split=tune. Native AI TTS only. AISHELL-3 is held out. tune_text_1.0 is not scored as held-out.",
        "excluded": list(BANNED),
        "nTrain": len(train),
        "heldout": heldout,
        "checks": checks,
    }
    OUT.write_text(json.dumps(payload) + "\n")
    print(f"wrote {OUT} train={len(train)} classes={classes}")


if __name__ == "__main__":
    main()
