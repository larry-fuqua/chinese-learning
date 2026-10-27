# Tone-pipeline audit

This folder measures the reader. It does not change how the reader slices audio, tracks pitch, or grades tones.

`score.py` calls the TypeScript functions in `src/lib` through `bridge.ts`, then compares them with:

- THCHS-30 test speakers (Apache 2.0), using published phone alignments whose IPA matches the Montreal Forced Aligner Mandarin dictionary
- Praat autocorrelation as the reference F0 tracker
- synthetic vowels with a known F0
- the 24 kHz clips already stored under `tests/fixtures/slice`
- one held-out alignment check on `tests/fixtures/owner-take` (not used for any tone score)

## Run

```bash
pip install -r eval/requirements.txt
npm install
python3 eval/score.py
```

Audio is cached under `/tmp/eval-data` and is not committed. The script expects:

- `/tmp/eval-data/align.parquet` from `anyspeech/THCHS-30-alignments`
- `/tmp/eval-data/test-0.parquet` from `changelinglab/thchs30-segment` (`data/test-00000-of-00002.parquet`)

`eval/results/metrics.json` is the machine-readable output. `eval/REPORT.md` is the write-up.
