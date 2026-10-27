# Tone pipeline audit

The reader is careful, and the pitch line is mostly real. The grade written next to it is not. On native Mandarin with the syllable boundaries already known, the tone it names is right about **55%** of the time, and a third tone is right about **31%** of the time. A clean, isolated dipping tone is called a rise. When the alignment service is down, the backup timer is off by roughly a tenth to a fifth of a second and the tone score falls to a guess.

This is not a matter of nudging a threshold that was almost right. The checks that have been added were each tried on a few sentences. Measured on a few hundred sentences of native speech, the scoring rule itself is the part that fails.

## In two minutes

What the app does, in order:

1. A story is split into sentences. Each word gets tone-marked pinyin from the model that prepared the story.
2. The sentence is spoken by the xAI voice `eve`. That service also returns a start and end time for each character. Those times are the backup clock.
3. A separate alignment service (a speech model that lines romanized syllables up with the audio) is asked for its own times. If it is missing, times out, or returns nothing, the app keeps the backup clock. For a recording of the learner, the backup is the speech-to-text word times, chopped into equal pieces per character, or, if those are missing too, the voiced stretches of the recording chopped to the right count.
4. Each character's audio is trimmed by fixed rules: start 30 ms early, end at a quiet point, then keep the loudest stretch if a pause falls inside the window.
5. Pitch is measured with a YIN tracker (70–400 Hz). The contour is drawn in semitones around that speaker's middle pitch, after throwing away the first 18% of the character.
6. A small formula, trained on 157 syllables of the app's own computer voice, names the tone. The on-screen sentence says "shape matches" when the formula gives the expected tone a probability of at least 0.25.

What the measurement says:

| Question | Result |
| --- | --- |
| Are the slices wildly wrong when the aligner succeeded? | The extra trim pulls the start **30 ms early**. **98%** of edges are still within 100 ms. Tone accuracy does not change (55% with the true boundary, 56% after the trim). |
| Are the slices wrong when the aligner failed? | Yes. Equal splits are off by about **130 ms** (39% miss the syllable). Chopping voiced stretches is off by about **190 ms**. Tone accuracy falls to **32%** and **26%**. |
| Is the pitch tracker the problem? | Mostly no. Against Praat, the median error is **0.35 semitones**, and only **3.8%** of voiced frames are grossly wrong. Using Praat's pitch raises the tone score from 55% to **60%**. A 460 Hz vowel is reported as 230 Hz, because nothing above 400 Hz is allowed. |
| Is the tone grade the problem? | Yes. Third-tone recall is **31%** for the formula and **0%** for the rise/dip rule (0 of 389). On speech that really has the expected tone, the screen says "shape matches" **65%** of the time and "shape is off" **28%** of the time. When the expected tone is a different one, it still says "shape matches" **19%** of the time. |
| Does a textbook dip survive? | No. An isolated dipping vowel is labeled tone 2. The first 18% of the syllable, which is discarded, is the part that makes it a dip. |

## What the code actually does

Nothing below is per sentence. The constants are global. Several of them exist because one recording looked better with that value.

### Text and the tone the app expects

Pinyin comes from the story preparation, one stored reading per word, then cut into one syllable per character (`splitWordPinyin`). The expected tone is not always the mark on that syllable. `spokenTones` rewrites it:

- These characters are forced to neutral tone when the reading is the light one: 了的得地吗呢吧啊着么.
- A repeated character (果果) makes every even copy neutral.
- 一 and 不 have their own rules, including 一 after 第 and 一 or 不 inside an A-not-A question.
- Two third tones in a row: the first becomes a second tone.

啊 with any tone mark has the base reading `a`, so it is always forced to neutral. That is a character exception, which is the kind of rule the product constraint forbids, and it fires even when 啊 is a full tone.

### Computer voice

`POST /api/tts` calls xAI `/v1/tts` with voice `eve`, speed 0.85 (clamped to 0.7–1.5), `with_timestamps: true`, wav at 24 kHz. The reply's `graph_chars` and `graph_times` are stored as the character clock. This audit did not call xAI. The five 24 kHz clips under `tests/fixtures/slice` are the recordings the pitch tests already use, including the one the test calls the AI voice.

If the largest timestamp is more than 5 times the audio length and greater than 20, the times are treated as milliseconds and divided by 1000 (`normalizeTimestampUnit`).

### Alignment sidecar, and the fallback

`fetchAlignment` posts the wav and one roman syllable per character to `/api/align`, which proxies `ALIGN_URL` (8 MB body, 25 s timeout). The sidecar (`align/server.py`) loads torchaudio's MMS forced aligner, keeps letters the model knows, and maps `v` to `u`. An empty syllable becomes `a`, `e`, `i`, or `u` so the character still gets a slot. Token spans come back in seconds. The server does not join those spans.

If `ALIGN_URL` is unset, the sidecar errors, or the span list is empty, the route returns 503 and the client logs "using token timings" and returns null. The caller then keeps the previous clock:

- For the computer voice: xAI `graph_times`, passed through `sliceWindows` and `applyOwnership`.
- For a learner take: speech-to-text words. A run of digits is rewritten as Chinese numerals (a special case for numbers). A word that covers several characters is split into **equal durations**. Those times then go through the same slicer.
- If there are no word times either: voiced stretches of the pitch track (gap larger than **0.11 s** starts a new stretch; stretches shorter than **35 ms** are dropped). If there are too many, the closest pair is merged. If there are too few, the longest is cut in half. Repeating that until the count matches is the proportional fallback. A stretch is forced to be at least **50 ms**.

### How a character slice is cut

`SLICE`: lead **30 ms**, extra pad **40 ms** beside a pause, silence threshold **0.15** times the 99th-percentile loudness, silence must hold **30 ms**, then **20 ms** of tail.

The end of a character is not the aligner's end. The code comment says the aligner stops about 100 ms before the vowel finishes, so the end is rebuilt from loudness. If the next token is another character, the end is the quietest moment between this token's end and the next token's start. The pause detector runs only when the next token is not a character (punctuation, or the last character). A string of characters with a real pause between them, and no punctuation in the timestamp list, is treated as a join.

`OWNERSHIP`: a gap of **100 ms** inside the window is a pause. The character keeps the loudest stretch, with **70 ms** of lead and **60 ms** of tail. Speech on the other side of the pause is given to the neighbor. Speech has to be both **0.05** times the peak and **2.5** times the quiet background, and at least **30 ms** long.

### Pitch

`extractPitch`: hop **10 ms**, window **40 ms**, YIN threshold **0.15**, search **70–400 Hz**. A frame quieter than **0.12** times the 90th-percentile energy is unvoiced. If the best YIN score is worse than **0.45**, the frame is unvoiced. A median filter of radius **4** follows. An octave jump (ratio above **1.85** or below **0.54**) is halved or doubled if the new value stays within **1.7** of the previous voiced frame; otherwise the frame is dropped. The previous frame is remembered across gaps up to **60 ms**.

The drawn contour is 16 bins. For a character longer than **80 ms**, the bins cover from **18%** in from the start to **6%** in from the end. Inside that, the longest voiced run is kept. A frame-to-frame jump larger than **1.25** starts a new run. Runs shorter than **20 ms** are dropped. Quiet edges below **0.3** of the run's peak are trimmed. Empty bins between voiced bins are filled with a straight line. Height is semitones versus the **sentence median** pitch. Fewer than 5 voiced frames uses **150 Hz** and a range of **8 semitones**.

Before the formula sees the contour, every value is divided by `k = clamp(sentenceRange / 8, 0.8, 1.6)`. That is a weak loudness knob, not a full speaker normalization.

### The grade, and the sentence on screen

`classifyTone` is the rise/dip rule on the drawn bins: flat if the range is under **1.2** semitones and the rise under **1**; a dip if the middle is **1.4** below the ends and **0.8** below each side; a rise or fall past **1.4**; neutral if the range is under **2**; otherwise whichever of rise or fall is left. It does not return "unsure."

`gradeContour` turns the same bins into 10 numbers (5 equal parts, mean, slope, curve, difference from the previous character, duration capped at **0.5 s**) and runs a logistic regression stored in `tone-model.json`. It was fit with scikit-learn, `C = 1`, on **157** syllables of the app's TTS, forced-alignment windows, tune split only. AISHELL-3 was held out. The owner's recording is banned from that script by id.

The line of text uses `contourVerdict`. Neutral expected tone, or a neutral guess, prints "light / short" and is not scored. No guess prints "no clear pitch." If the rise/dip rule and the expected tone are an opposite pair (2nd versus 4th only), it prints "shape is off" even when the probability is high. Otherwise it prints "shape matches" when the probability of the expected tone is at least **0.25**. That 0.25 is written twice: once as `acceptAt` in the model file, and once as a literal in `contourVerdict`. For four tones, 0.25 is what you get from knowing nothing.

The tone name printed next to the line is the formula's guess, unless that guess and the rise/dip rule are 2nd versus 4th, in which case the name follows the rule. Other disagreements between the line and the name are left as they are. The product constraint is that the words and the line say the same thing. The 2nd-versus-4th override is the only place that is enforced.

## How this was measured

Native speech is the THCHS-30 test speakers (ids starting with D), Apache 2.0. Audio is the test shard of `changelinglab/thchs30-segment`. Phone times and Chao tone marks are the published alignments in `anyspeech/THCHS-30-alignments`. The phone set (IPA, Chao tones, length marks) matches the Montreal Forced Aligner Mandarin dictionary. The original THCHS-30 release has tone-marked pinyin and no time stamps. MFA was not run again in this audit, and these alignments are forced alignments, not hand labels. Utterances where the phones did not fall into one syllable per character were dropped, so a bad grouping could not shift later characters.

| Set | Size |
| --- | --- |
| Alignment | 300 utterances, 9,648 characters, the test speakers present in the shard |
| Pitch and tone | 64 of those utterances, 10 speakers, 1,970 syllables with a lexical tone (plus 70 neutral) |
| Tone counts | 1st 523, 2nd 436, 3rd 389, 4th 622 |
| App clips | 5 fixtures, 100 tonal syllables, windows already stored with the tests |
| Owner take | 19 hand-marked characters, alignment only |

The app's own functions did the slicing, the YIN track, the formula, and the "shape matches" decision (`eval/bridge.ts`). Reference pitch is Praat autocorrelation, 10 ms, floor 70 Hz, ceiling 500 Hz, so a pitch above the app's 400 Hz cap can still be seen. No weight and no threshold was chosen using the owner's recording.

"Oracle" below means the published syllable boundary, including the initial consonant. "Sliced" means those same boundaries after `sliceWindows` and `applyOwnership`.

## Alignment

Error is the hypothesis edge minus the reference edge, in milliseconds. A negative start means the app window begins early. "Within 50 ms" means both edges are within 50 ms. Bleed is how much of the window sits on a neighboring syllable.

| Clock | Characters | Median \|start\| | Median \|end\| | Median signed start | Within 50 ms | Within 100 ms | Miss | Median bleed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Tokens, unchanged | 9648 | 0 ms | 0 ms | 0 | 100% | 100% | 0.3% | 0 |
| Slicer on those tokens | 9648 | 30 ms | 0 ms | **−30 ms** | 73% | 98% | 0% | 30 ms |
| Same path via the alignment post-process | 9648 | 30 ms | 0 ms | −30 ms | 73% | 98% | 0% | 30 ms |
| Equal split of the whole utterance | 9648 | 135 ms | 130 ms | +4 ms | 13% | 31% | 39% | 84 ms |
| Equal split, then the slicer | 9648 | 133 ms | 128 ms | −20 ms | 8% | 30% | 36% | 97 ms |
| Voiced-stretch chopping | 2040 | 191 ms | 189 ms | −14 ms | 6% | 18% | 54% | 88 ms |

The 30 ms start shift is `LEAD_SEC`, applied to every character. It is not a random miss. On these phone boundaries the end is already usable, so the loudness rebuild does not move it (median end error 0). Tone accuracy with the true boundary is 54.9%. After the slicer it is 56.0%. The trim is not where the tone errors come from, as long as the token times were right.

The two fallbacks are a different story. They are off by a syllable or more, and the tone score goes to chance. The slicer does not repair an equal split.

On a synthetic four-syllable sentence with known edges and 110 ms gaps, the slicer again starts **30 ms early** (median). One edge landed 70 ms off because the pad beside a pause is 40 ms on top of the 30 ms lead.

The owner's take is one sentence with hand marks, held out of every tone number. The stored sidecar spans, compared with those marks: median start **+47 ms** (late), median end **−69 ms** (early), only 21% of characters within 50 ms on both edges, overlap 0.59. That early end matches the comment in the slicer. After the slicer: median edges 39 ms and 50 ms, 95% within 100 ms, overlap 0.79. The slicer does what it was tuned to do on this recording. It does not move the tone score on native speech whose boundaries were already right.

## Pitch

Frames inside a reference syllable, app YIN against Praat. 42,643 frames, 25,230 voiced in both.

| | |
| --- | ---: |
| Voicing recall (Praat voiced, app voiced) | 86% |
| Voicing false alarm (Praat unvoiced, app voiced) | 26% |
| Frames that disagree | 18% |
| Gross error (more than 20% in frequency), both voiced | 3.8% |
| Octave error | 2.9% |
| Within 1 semitone | 80% |
| Median absolute error | 0.35 semitones |
| Praat frames above 400 Hz | 1.1% |

A flat 460 Hz vowel is tracked as a flat **230 Hz**. The tone is still "high and level," so the grade happens to be right, and the octave error is invisible to the tone score. A fall that starts above 400 Hz would be bent. The cap is `MAX_HZ`.

Missing-fundamental test: a rising tone with energy only on harmonics 2 and up was tracked on the right octave and graded as a rise. YIN is doing the job it was chosen for. It is not the main failure.

## Tone grades

Argmax accuracy of the logistic formula, against the alignment's lexical tone. Chance, if you always say 4th tone, is about 32%.

| Contour source | Accuracy | 1st | 2nd | 3rd | 4th |
| --- | ---: | ---: | ---: | ---: | ---: |
| True boundary, app pitch | **54.9%** | 60% | 64% | **31%** | 59% |
| Slicer boundary, app pitch | 56.0% | 62% | 62% | 29% | 64% |
| True boundary, Praat pitch | 60.1% | 55% | 67% | 39% | **73%** |
| True boundary, Praat pitch on the frames the app already called voiced | 57.5% | 56% | 60% | 24% | 78% |
| True boundary, onset crop turned off | 55.8% | 56% | 65% | 31% | 65% |
| Equal-split boundary | 31.5% | 35% | 38% | 14% | 36% |
| Voiced-stretch boundary | 26.1% | 33% | 23% | 14% | 31% |
| Rise/dip rule, true boundary, app pitch | 45.9% | 75% | 35% | **0%** | 57% |

Same 10 numbers, new weights fit on the other native speakers and tested on speakers D7 and D8 (369 syllables): **68.8%**. The shipped weights score 58.3% on that same pair of speakers. Majority class is 32.8%. Retuning the shipped formula on native speech helps, and it still leaves third tone weak (35 of 65 on that held-out pair). The 10 numbers are a limited picture of the contour. The slope of a dip is near zero or positive, so a straight-line feature calls a dip a rise.

### Confusion, true boundary, app pitch

Rows are the true tone. Columns are the guess. `none` means the contour had too few voiced bins.

| True \ guess | 1 | 2 | 3 | 4 | none |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 316 | 41 | 18 | 137 | 11 |
| 2 | 74 | 279 | 38 | 20 | 25 |
| 3 | 36 | 102 | 119 | 69 | 63 |
| 4 | 69 | 41 | 101 | 368 | 43 |

Third tone is called a second tone almost as often as it is called a third (102 versus 119), and 63 of 389 have no grade at all.

### Rise/dip rule on the same contours

| True \ guess | 1 | 2 | 3 | 4 | none |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 393 | 21 | 0 | 36 | 73 |
| 2 | 155 | 154 | 1 | 37 | 89 |
| 3 | 127 | 19 | **0** | 136 | 107 |
| 4 | 157 | 8 | 0 | 357 | 100 |

The rule's third-tone branch did not fire on a single true third tone. It fired once, on a second tone. Native third tones in this read speech are low falls: of 249 third tones with enough Praat frames, the later part of the syllable is a median **3.8 semitones lower** than the beginning, and **83%** fall by more than 1 semitone. A rule that requires a dip in the middle cannot see them. That is the connected-speech third tone (the half third), and the template is the citation dip from a textbook.

### The sentence on the screen

Expected tone set to the true tone (1,970 syllables):

| Written line | Share |
| --- | ---: |
| shape matches | 65.2% |
| shape is off | 27.6% |
| no clear pitch | 7.2% |

Of the "shape matches" lines, **11%** of all syllables are a match even though the formula's top tone is a different one. The probability of the true tone cleared 0.25 anyway.

Expected tone set to each of the three wrong tones (5,910 trials): **"shape matches" on 19.3%**. The 2nd-versus-4th override blocked that line 25 times. It is not carrying the decision.

The app's own sandhi rewrite agreed with the alignment tone on **93%** of syllables. On the syllables where they agree, accuracy is 56.5%. The character rules for 一, 不, and particles are not the bulk of the misses. They are still per-character exceptions inside the grader.

### The same formula on the contours already stored in the repo

`scripts/data/tone-rows.json` is the set the training script held out. Re-scored with the current code, not with the numbers baked into the model file at training time:

| Set | Syllables | Argmax | "shape matches" on the true tone | "shape matches" on a wrong tone |
| --- | ---: | ---: | ---: | ---: |
| AISHELL-3, alignment windows | 496 | 57.7% | 71% | 20% |
| App TTS, held out | 750 | 71.6% | 83% | 17% |
| App TTS, the tune set the weights saw | 159 | 70.4% | 84% | 16% |

The formula fits its own computer voice better than native speech (72% versus 55–58%). That gap is what a 157-syllable TTS training set produces. The fresh THCHS run lands in the same place as the stored AISHELL contours, so this is not an artifact of one corpus.

### The app's own clips

Gold is the tone `spokenTones` expects, which is what the screen is judging. Windows are the ones stored in the fixture, so this is not an alignment test.

| Clip | Syllables | Argmax | "shape matches" | "shape is off" |
| --- | ---: | ---: | ---: | ---: |
| ch1_01_H | 18 | 56% | 61% | 39% |
| ch1_01_M | 18 | 61% | 67% | 33% |
| ch1_01_P (the test's AI voice) | 18 | 67% | 72% | 28% |
| ch1_15_P | 40 | 60% | 73% | 28% |
| xm_03_H | 6 | 67% | 67% | 33% |
| All five | 100 | **61%** | **69%** | about 31% |

About one character in three on these clips is told the shape is off, including the computer voice. The unit test for 学 on the AI voice already requires the line to say "shape is off" and to call a second tone a fall. That test locks the failure in.

### Isolated dip

妈麻马骂, harmonic vowels, known pitch, 110 ms gaps. True boundaries.

| Syllable | True | Formula | Rise/dip rule | With the onset kept, rise/dip rule |
| --- | --- | --- | --- | --- |
| mā | 1 | 1 | 1 | 1 |
| má | 2 | 2 | 2 | 2 |
| mǎ | 3 | **2** | **2** | **3** |
| mà | 4 | 4 | 4 | 4 |

The third-tone features with the crop are a rise from the bottom: about −4.5, −5.3, −5.1, −3.8, −1.9 semitones. Probability of tone 3 is about 0. Without the crop the five parts are −2.5, −4.8, −5.3, −4.1, −1.9, a dip, and the rise/dip rule says 3. The logistic formula still says 2. Both the crop and the weights are wrong for a dip, and they are wrong in the same direction.

## Root causes

**1. The grader describes a textbook dip, and native third tones are not that shape.** This is the largest error on every path where the boundary is roughly right. The rise/dip rule scores 0 of 389 native third tones. The logistic formula scores 31%, and it was trained on 157 computer-voice syllables, where it looks better (about 72%). A clean isolated dip is called a rise. Fitting a new straight line to the same 10 numbers, on native speakers, reaches 69% and still struggles with tone 3. More threshold edits will not fix a representation that turns a dip into a positive slope. Design, not tuning.

**2. "Shape matches" means "probability at least 0.25."** That is the uninformed value for four tones. On native speech the line agrees with a correct tone 65% of the time, says the shape is off 28% of the time, and agrees with a wrong tone 19% of the time. Eleven percent of syllables get a match while the formula's favorite tone is a different one. The words can also name a tone the line does not show, because only a 2nd-versus-4th clash is forced to follow the drawing. Design of the decision.

**3. The backup clock, used whenever the sidecar fails, does not find syllables.** Equal splits and voiced-stretch chopping are off by 130–190 ms and drop the tone score from about 55% to 26–32%. The slicer on top of a good token is a fixed 30 ms lead and does not move the tone score. The post-processing was aimed at one failure mode (sidecar ends that stop early, visible on the owner's 19 hand marks, median end 69 ms early) and does not repair a bad clock. The harmful stage is the fallback, and it is a design fallback: invent times rather than say the timing is unknown.

Pitch is a smaller contributor: about five points of tone accuracy, and a real octave error above 400 Hz. It is not what makes a third tone look like a second tone.

## What to change

Ranked by how much of the measured error it addresses, then by how much code it takes. None of these need a per-character, per-voice, or per-number exception. A learned model, if one is trained, trains on native speech only. The owner's takes stay out of it.

**1. Stop printing a firm yes or no.** If the top tone is not clearly ahead of the others, say that the pitch is unclear and show the line. If a tone is named, name the shape that is actually drawn, including a low fall, not only when the clash is 2nd versus 4th. Effort is small: `contourVerdict` and the label next to the graph. This removes the 19% false "matches" and the matches that disagree with the formula's own top tone. It does not make the underlying 55% into a good classifier. It stops the screen from sounding sure.

**2. For the per-character practice mode, grade against that character's clean reference, not against a tone class.** Draw the learner's contour and the reference contour in the same semitone frame, and describe the difference (higher, lower, flatter, still falling). On the stored native contours, fourth tones resemble each other (correlation about 0.60) and do not resemble other tones (about 0.09). First tones are flat, so they need a level comparison rather than a correlation. Third tones inside sentences only weakly match each other (0.30 versus 0.15), because they are half-thirds of different sizes. A clean isolated reference is the contour worth matching. The synthetic 马 shows why a class label is the wrong report: the line can be a dip while the label says "rise." Effort is moderate, and it depends on having the isolated reference audio. It keeps the words and the drawing on the same object.

**3. If a tone class is still required, train it on native connected speech, and treat the third tone as the low tone speakers actually use.** A published Mandarin tone model trained on read speech is a better start than another logistic fit on these 10 numbers. The linear refit here is the evidence that the current features top out near 70% on held-out speakers, with third tone still the weak class. Do not tune it on the learner's recordings. Effort is larger than 1 or 2. This is the change that can move argmax accuracy. Retuning dip constants on a handful of sentences will not.

**4. Keep a forced aligner, and if it fails, leave the character blank.** Equal splits and voiced-stretch cuts should not be shown as character boundaries. The measured cost of that fallback is the entire tone score (55% down to about 30%) plus 130–190 ms of boundary error. A Mandarin wav2vec2 / CTC aligner, or Montreal Forced Aligner with its Mandarin model, is a better token source than roman MMS plus a hand-tuned end repair. The current sidecar is already in this family; the bug is what happens when it is absent, and the end repair that assumes it always stops 100 ms early. Effort is moderate. On this test set the slicer's 30 ms lead is tolerable. It does not need another round of per-sentence pad values.

**5. Let the pitch tracker see above 400 Hz, and stop dropping the first 18% of every character.** Small change. The 460 Hz vowel is the evidence for the ceiling (tracked at 230 Hz). The isolated 马 is the evidence for the crop (the rise/dip rule flips from wrong to right when the onset is kept). On this corpus those two fixes are a few points overall, and Praat's pitch is worth about five points, mostly on fourth tones (59% to 73% recall). Do them with the grader change, not as the whole project.

**6. Put sandhi in the stored pronunciation.** The grader should score the reading this sentence is supposed to use. Sequence rules (two third tones, neutral reduplication) can stay generic. 一, 不, and the particle list are character exceptions; they are 7% of this test, not the main error, and they conflict with the "no special cases" rule.

### Isolated computer-voice audio, and an isolated recite

A planned mode gives each character its own clean TTS and its own short recording. The Hear / Recite buttons added after this snapshot are that mode's first UI. The grade behind them is still the sentence formula and the rise/dip rule measured here.

That removes sentence slicing, pause ownership, the equal-split fallback, and most of the neighboring-tone drag. Those are real. On this benchmark they are the difference between a usable boundary (30 ms, tone score unchanged) and a useless one (130–190 ms, tone score at chance), **when the sidecar is down**. When the sidecar is up, slicing is not the tone error, so isolation does not repair the 55% grade.

Isolation also changes the third tone the learner is asked to match, from a low fall inside a sentence to a full dip on its own. The current grader fails that full dip too: the synthetic 马 was called a rise, and the probability of tone 3 was about zero. So a clean clip does not make the present formula trustworthy.

What isolation does make possible is item 2. Compare the short recording to that character's own reference line. The words then describe those two lines. Sentence playback can keep a forced aligner for the karaoke highlight. It should not invent a highlight when alignment fails, and it should not grade a third tone inside a sentence as if it were a citation dip.

## Code that landed after this measurement

The numbers above are the sentence pipeline at `07818ef`. Two later commits on `cursor/self-host-reader-7070` (`95923b0`, `d0499bc`) add a per-character Hear / Recite panel. They do not change the slicer, the YIN tracker, the logistic weights, or the sentence-level "shape matches" test at 0.25. The new practice line (`practiceFeedback`) takes its tone name from the rise/dip rule on the contour that is drawn, and it says "shape is off" whenever that rule's class is not the expected tone. That is the direction of recommendation 1 for the practice panel. The rule it uses is the same `classifyTone` that scored 0 of 389 native third tones, and that calls the cropped isolated dip a rise. When the rule returns nothing, the practice line falls back to the 0.25 probability. This audit did not re-run the benchmark on that panel.

## What this does not show

The phone times are someone else's forced alignment, checked by whether they split into one syllable per character, not by a new hand pass. Sixty-four utterances is enough for the tone rates above to be stable at the level of a few points, and not enough to rank two close model designs. The five app clips are the in-repo fixtures, not a new sample of the eve voice. The owner's recording was used only as the 19 hand marks.
