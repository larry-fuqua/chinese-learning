"use client";

import { useEffect, useRef, useState } from "react";
import { canonicalTone, strokeWithGaps } from "@/lib/pitch";
import {
  binCenterX,
  sentencePxPerSec,
  semitoneToY,
  sharedPitchAxis,
  type PitchAxis,
} from "@/lib/pitch-scale";
import { pitchTrackNote, toneDifferenceLabel } from "@/lib/sandhi";
import { toneName } from "@/lib/text";
import type { PitchPoint, SyllablePitch, ToneGraph } from "@/lib/types";

export type ReplayTrack = "model" | "yours";

export function PitchGraph({
  graph,
  selected,
  playheadT,
  onSelect,
  replayTrack,
  onReplayTrack,
  replayIndex,
  playingTrack,
  hasUserAudio,
  onReplay,
}: {
  graph: ToneGraph;
  selected: number;
  playheadT: number | null;
  onSelect: (index: number) => void;
  replayTrack: ReplayTrack;
  onReplayTrack: (track: ReplayTrack) => void;
  replayIndex: number | null;
  playingTrack: ReplayTrack | null;
  hasUserAudio: boolean;
  onReplay: (index: number, alternate: boolean) => void;
}) {
  const [pxPerSec, setPxPerSec] = useState(0);
  const syllable = graph.syllables[selected] ?? graph.syllables[0];
  const hasUserTake = graph.userPitch.some((p) => p.hz != null);
  const syllableHasUser = syllable?.userStart != null;
  const difference = syllable
    ? toneDifferenceLabel(syllable.dictionaryTone, syllable.spokenTone, syllable.toneNote)
    : null;
  const axis = sharedPitchAxis(
    graph.syllables.flatMap((item) => [item.refSemitones, item.userSemitones]),
  );

  return (
    <section className="bg-graph text-paper">
      <div className="px-4 py-1.5 sm:px-6">
        <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1">
          <p className="font-[family-name:var(--font-sans)] text-[10px] uppercase tracking-[0.18em] text-ref">
            Pitch
          </p>
          {syllable ? (
            <p className="min-w-0 truncate font-[family-name:var(--font-sans)] text-xs text-paper/80">
              <span className="hanzi text-base text-paper">{syllable.hanzi}</span>{" "}
              {syllable.pinyin} · {toneName(syllable.expectedTone)}
              {difference ? ` · ${difference}` : ""}
              {syllable
                ? pitchTrackNote({
                    track: replayTrack,
                    hasUserTake,
                    expectedTone: syllable.expectedTone,
                    heardTone: syllable.heardTone,
                    modelHeardTone: syllable.modelHeardTone,
                    pExpected: syllable.pExpected,
                    modelPExpected: syllable.modelPExpected,
                    userStart: syllable.userStart,
                    start: syllable.start,
                    end: syllable.end,
                  })
                : ""}
            </p>
          ) : null}
          {graph.heard ? (
            <p className="font-[family-name:var(--font-sans)] text-xs text-paper/55">
              You said{" "}
              <span className="hanzi text-paper/80">{graph.heard || "—"}</span>
            </p>
          ) : null}
          <div className="ml-auto flex gap-3 font-[family-name:var(--font-sans)] text-[11px] text-paper/60">
            <span>
              <i className="mr-1 inline-block h-0.5 w-3 align-middle bg-ref" />
              Ref
            </span>
            <span className={hasUserTake ? "" : "opacity-40"}>
              <i className="mr-1 inline-block h-0.5 w-3 align-middle bg-you" />
              You
            </span>
            <span>
              <i className="mr-1 inline-block h-0.5 w-3 align-middle bg-template" />
              Tone
            </span>
          </div>
        </div>

        <div className="flex gap-3">
          <SentenceCanvas
            refPitch={graph.refPitch}
            userPitch={graph.userPitch}
            syllables={graph.syllables}
            duration={graph.duration}
            playheadT={playheadT}
            selected={selected}
            replayIndex={replayIndex}
            playingTrack={playingTrack}
            axis={axis}
            onPxPerSec={setPxPerSec}
          />
          <div className="w-36 shrink-0 sm:w-44">
            <SyllableCanvas
              syllable={syllable}
              showUser={syllableHasUser}
              axis={axis}
              pxPerSec={pxPerSec}
            />
          </div>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <div
            className="flex rounded-full bg-white/10 p-0.5 font-[family-name:var(--font-sans)] text-[11px]"
            role="group"
            aria-label="Which recording a character plays"
          >
            <button
              type="button"
              onClick={() => onReplayTrack("model")}
              className={`rounded-full px-2 py-0.5 ${
                replayTrack === "model" ? "bg-paper text-ink" : "text-paper/70"
              }`}
              aria-pressed={replayTrack === "model"}
            >
              Model
            </button>
            <button
              type="button"
              disabled={!hasUserAudio}
              onClick={() => onReplayTrack("yours")}
              className={`rounded-full px-2 py-0.5 disabled:opacity-40 ${
                replayTrack === "yours" ? "bg-paper text-ink" : "text-paper/70"
              }`}
              aria-pressed={replayTrack === "yours"}
            >
              Yours
            </button>
          </div>
          <p className="font-[family-name:var(--font-sans)] text-[11px] text-paper/55">
            Click a character to hear {replayTrack === "model" ? "the model" : "your recording"}.
            Shift-click hears the other.
          </p>
        </div>
        <div className="mt-1 flex flex-wrap gap-0.5">
          {graph.syllables.map((s, i) => {
            const diff = toneDifferenceLabel(s.dictionaryTone, s.spokenTone, s.toneNote);
            const playing = replayIndex === i;
            return (
              <button
                key={`${s.hanzi}-${i}`}
                type="button"
                onClick={(event) => {
                  onSelect(i);
                  onReplay(i, event.shiftKey);
                }}
                className={`hanzi min-w-7 rounded px-1.5 py-0.5 text-base ${
                  playing
                    ? "bg-[#e8c27a] text-ink ring-2 ring-[#e8c27a]"
                    : i === selected
                      ? "bg-paper text-ink"
                      : s.userStart == null && hasUserTake
                        ? "bg-white/10 text-paper/35 hover:bg-white/16"
                        : "bg-white/10 text-paper hover:bg-white/16"
                }`}
                title={
                  diff
                    ? `${s.pinyin} ${toneName(s.spokenTone)} · ${diff}`
                    : `${s.pinyin} ${toneName(s.spokenTone)}`
                }
              >
                {s.hanzi}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function SentenceCanvas({
  refPitch,
  userPitch,
  syllables,
  duration,
  playheadT,
  selected,
  replayIndex,
  playingTrack,
  axis,
  onPxPerSec,
}: {
  refPitch: PitchPoint[];
  userPitch: PitchPoint[];
  syllables: SyllablePitch[];
  duration: number;
  playheadT: number | null;
  selected: number;
  replayIndex: number | null;
  playingTrack: ReplayTrack | null;
  axis: PitchAxis;
  onPxPerSec: (pxPerSec: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const userTimes = syllables
      .map((s) => s.userEnd ?? 0)
      .concat(syllables.map((s) => s.end));
    const span = Math.max(
      duration,
      lastTime(refPitch),
      lastTime(userPitch),
      ...userTimes,
      0.2,
    );
    const hasUser = syllables.some((s) => s.userStart != null);
    const gap = hasUser ? 6 : 0;
    const band = hasUser ? (height - gap) / 2 : height;
    const refTop = 0;
    const userTop = hasUser ? band + gap : 0;

    ctx.strokeStyle = "rgba(243, 234, 216, 0.08)";
    ctx.lineWidth = 1;
    const bandLines = hasUser ? [0.5] : [0.25, 0.5, 0.75];
    for (const f of bandLines) {
      ctx.beginPath();
      ctx.moveTo(0, refTop + band * f);
      ctx.lineTo(width, refTop + band * f);
      ctx.stroke();
      if (hasUser) {
        ctx.beginPath();
        ctx.moveTo(0, userTop + band * f);
        ctx.lineTo(width, userTop + band * f);
        ctx.stroke();
      }
    }
    if (hasUser) {
      ctx.fillStyle = "rgba(243, 234, 216, 0.35)";
      ctx.font = "9px 'Source Sans 3', sans-serif";
      ctx.fillText("ref", 2, refTop + 10);
      ctx.fillText("you", 2, userTop + 10);
    }

    syllables.forEach((s, i) => {
      if (s.end > s.start) {
        const x0 = (s.start / span) * width;
        const x1 = (s.end / span) * width;
        if (replayIndex === i && playingTrack === "model") {
          ctx.fillStyle = "rgba(232, 194, 122, 0.32)";
          ctx.fillRect(x0, refTop, Math.max(2, x1 - x0), band);
        } else if (i === selected) {
          ctx.fillStyle = "rgba(232, 194, 122, 0.12)";
          ctx.fillRect(x0, refTop, Math.max(2, x1 - x0), band);
        }
        ctx.fillStyle = "rgba(243, 234, 216, 0.5)";
        ctx.font = "12px 'Noto Serif SC', serif";
        ctx.fillText(s.hanzi, x0 + Math.max(2, (x1 - x0) / 2 - 6), refTop + 12);
        drawLineInSlot(ctx, s.refSemitones, x0, x1, refTop, band, "#e8c27a", 2.1, axis);
      }
      if (s.userStart != null && s.userEnd != null && s.userEnd > s.userStart) {
        const ux0 = (s.userStart / span) * width;
        const ux1 = (s.userEnd / span) * width;
        if (replayIndex === i && playingTrack === "yours") {
          ctx.fillStyle = "rgba(243, 234, 216, 0.28)";
          ctx.fillRect(ux0, userTop, Math.max(2, ux1 - ux0), band);
        } else if (i === selected) {
          ctx.fillStyle = "rgba(243, 234, 216, 0.08)";
          ctx.fillRect(ux0, userTop, Math.max(2, ux1 - ux0), band);
        }
        drawLineInSlot(ctx, s.userSemitones, ux0, ux1, userTop, band, "#f3ead8", 2.2, axis);
      }
    });

    if (playheadT != null) {
      const x = (playheadT / span) * width;
      ctx.strokeStyle = "#c44a32";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    onPxPerSec(sentencePxPerSec(width, span));
  }, [refPitch, userPitch, syllables, duration, playheadT, selected, replayIndex, playingTrack, axis, onPxPerSec]);

  return (
    <canvas
      ref={canvasRef}
      className={`w-full min-w-0 flex-1 ${syllables.some((s) => s.userStart != null) ? "h-20" : "h-16"}`}
      aria-label="Sentence pitch contour"
    />
  );
}

function SyllableCanvas({
  syllable,
  showUser,
  axis,
  pxPerSec,
}: {
  syllable?: SyllablePitch;
  showUser: boolean;
  axis: PitchAxis;
  pxPerSec: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !syllable) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(243, 234, 216, 0.08)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (height * i) / 4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const template = canonicalTone(syllable.expectedTone);
    const modelDur = Math.max(0, syllable.end - syllable.start);
    const userDur =
      syllable.userStart != null && syllable.userEnd != null && syllable.userEnd > syllable.userStart
        ? syllable.userEnd - syllable.userStart
        : 0;
    const modelW = modelDur * pxPerSec;
    const userW = userDur * pxPerSec;
    if (modelW > 1) {
      drawLine(ctx, template, modelW, height, "#8aa88f", 1.5, true, axis);
      drawLine(ctx, syllable.refSemitones, modelW, height, "#e8c27a", 2.4, false, axis);
    }
    if (showUser && userW > 1) {
      drawLine(ctx, syllable.userSemitones, userW, height, "#f3ead8", 3.2, false, axis);
    }
  }, [syllable, showUser, axis, pxPerSec]);

  return (
    <canvas
      ref={ref}
      className="h-16 w-full"
      aria-label="Pitch overlay for the selected syllable"
    />
  );
}

function lastTime(points: PitchPoint[]): number {
  return points.length ? points[points.length - 1].t : 0;
}

function drawLineInSlot(
  ctx: CanvasRenderingContext2D,
  values: (number | null)[],
  x0: number,
  x1: number,
  yTop: number,
  bandH: number,
  color: string,
  lineWidth: number,
  axis: PitchAxis,
) {
  if (values.filter((value) => value != null).length < 2) return;
  const x = (i: number) => binCenterX(i, values.length, x0, x1);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  strokeWithGaps(ctx, values, x, (value) => yTop + semitoneToY(value, bandH, axis));
  ctx.restore();
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  values: (number | null)[],
  width: number,
  height: number,
  color: string,
  lineWidth: number,
  dashed: boolean,
  axis: PitchAxis,
) {
  if (values.filter((value) => value != null).length < 2 || !(width > 1)) return;
  const x = (i: number) => binCenterX(i, values.length, 0, width);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (dashed) ctx.setLineDash([5, 5]);
  strokeWithGaps(ctx, values, x, (value) => semitoneToY(value, height, axis));
  ctx.restore();
}
