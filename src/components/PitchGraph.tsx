"use client";

import { useEffect, useRef } from "react";
import { canonicalTone, classifyTone, strokeWithGaps } from "@/lib/pitch";
import {
  binCenterX,
  characterPxPerSec,
  LABEL_MIN_GAP,
  laneTime,
  laneX,
  pitchPlotLayout,
  semitoneToY,
  separateLabelCenters,
  sharedPitchAxis,
  type PitchAxis,
  type PlotBand,
} from "@/lib/pitch-scale";
import { heardCaption } from "@/lib/take-display";
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
  referenceText,
  savedTakeAvailable,
  showingPreviousTake,
  onTogglePreviousTake,
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
  referenceText: string;
  savedTakeAvailable: boolean;
  showingPreviousTake: boolean;
  onTogglePreviousTake: () => void;
}) {
  const syllable = graph.syllables[selected] ?? graph.syllables[0];
  const showUser = graph.syllables.some((item) => item.userStart != null);
  const hasUserTake = showUser && graph.userPitch.some((point) => point.hz != null);
  const syllableHasUser = syllable?.userStart != null;
  const difference = syllable
    ? toneDifferenceLabel(syllable.dictionaryTone, syllable.spokenTone, syllable.toneNote)
    : null;
  const axis = sharedPitchAxis(
    graph.syllables.flatMap((item) =>
      showUser ? [item.refSemitones, item.userSemitones] : [item.refSemitones],
    ),
  );
  const durations = graph.syllables.flatMap((item) => {
    const out: number[] = [];
    if (item.end > item.start) out.push(item.end - item.start);
    if (
      showUser &&
      item.userStart != null &&
      item.userEnd != null &&
      item.userEnd > item.userStart
    ) {
      out.push(item.userEnd - item.userStart);
    }
    return out;
  });
  const caption = heardCaption({
    track: replayTrack,
    referenceText,
    userText: hasUserTake ? graph.heard : "",
    previous: showingPreviousTake,
  });

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
                    shapeTone: classifyTone(
                      replayTrack === "model" ? syllable.refSemitones : syllable.userSemitones,
                    ),
                  })
                : ""}
            </p>
          ) : null}
          {caption ? (
            <p className="font-[family-name:var(--font-sans)] text-xs text-paper/55">
              {caption.startsWith("Previous take") ? (
                <>
                  <span className="text-paper/80">Previous take</span>
                  {" · "}
                  Heard: <span className="hanzi text-paper/80">{caption.replace(/^Previous take · Heard:\s*/, "")}</span>
                </>
              ) : (
                <>
                  Heard:{" "}
                  <span className="hanzi text-paper/80">{caption.replace(/^Heard:\s*/, "")}</span>
                </>
              )}
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

        <div className="flex items-stretch gap-3">
          <SentenceCanvas
            refPitch={graph.refPitch}
            userPitch={graph.userPitch}
            syllables={graph.syllables}
            playheadT={playheadT}
            selected={selected}
            replayIndex={replayIndex}
            playingTrack={playingTrack}
            replayTrack={replayTrack}
            axis={axis}
            showUser={showUser}
            previousTake={showingPreviousTake}
          />
          <div className="w-44 shrink-0 self-start sm:w-52">
            <SyllableCanvas
              syllable={syllable}
              showUser={syllableHasUser}
              axis={axis}
              durations={durations}
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
          {savedTakeAvailable && !hasUserTake ? (
            <button
              type="button"
              onClick={onTogglePreviousTake}
              className="rounded-full bg-white/10 px-2 py-0.5 font-[family-name:var(--font-sans)] text-[11px] text-paper/80"
              aria-pressed={false}
            >
              Show previous take
            </button>
          ) : null}
          {showingPreviousTake ? (
            <button
              type="button"
              onClick={onTogglePreviousTake}
              className="rounded-full bg-paper px-2 py-0.5 font-[family-name:var(--font-sans)] text-[11px] text-ink"
              aria-pressed={true}
            >
              Previous take
            </button>
          ) : null}
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
  playheadT,
  selected,
  replayIndex,
  playingTrack,
  replayTrack,
  axis,
  showUser,
  previousTake,
}: {
  refPitch: PitchPoint[];
  userPitch: PitchPoint[];
  syllables: SyllablePitch[];
  playheadT: number | null;
  selected: number;
  replayIndex: number | null;
  playingTrack: ReplayTrack | null;
  replayTrack: ReplayTrack;
  axis: PitchAxis;
  showUser: boolean;
  previousTake: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!(width > 0) || !(height > 0)) return;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const modelStarts: number[] = [];
      const modelEnds: number[] = [];
      const userStarts: number[] = [];
      const userEnds: number[] = [];
      for (const syllable of syllables) {
        if (syllable.end > syllable.start) {
          modelStarts.push(syllable.start);
          modelEnds.push(syllable.end);
        }
        if (showUser && syllable.userStart != null && syllable.userEnd != null) {
          userStarts.push(syllable.userStart);
          userEnds.push(syllable.userEnd);
        }
      }
      const modelLane = laneTime({ starts: modelStarts, ends: modelEnds });
      const userLane = laneTime({ starts: userStarts, ends: userEnds });
      const layout = pitchPlotLayout({ width, height, showUser });
      const xModel = (t: number) => laneX(t, modelLane, layout.gutter, layout.plotWidth);
      const xUser = (t: number) => laneX(t, userLane, layout.gutter, layout.plotWidth);
      const family = canvasFont();

      drawGrid(ctx, layout.gutter, layout.plotWidth, layout.ref);
      if (layout.user) drawGrid(ctx, layout.gutter, layout.plotWidth, layout.user);
      if (layout.user) {
        ctx.fillStyle = "rgba(243, 234, 216, 0.45)";
        ctx.font = `10px ${family.sans}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText("ref", 2, layout.ref.top + layout.ref.height / 2);
        ctx.fillText(
          previousTake ? "prev" : "you",
          2,
          layout.user.top + layout.user.height / 2,
        );
      }

      const modelLabels: LabelSlot[] = [];
      const userLabels: LabelSlot[] = [];
      syllables.forEach((s, i) => {
        if (s.end > s.start) {
          const x0 = xModel(s.start);
          const x1 = xModel(s.end);
          paintSlot(ctx, x0, x1, layout.ref, i === selected, replayIndex === i && playingTrack === "model");
          clipDraw(ctx, layout.gutter, layout.ref, layout.plotWidth, () => {
            drawLineInSlot(ctx, s.refSemitones, x0, x1, layout.ref, "#e8c27a", 2.2, axis);
          });
          modelLabels.push({ index: i, hanzi: s.hanzi, x0, x1 });
        }
        if (showUser && s.userStart != null && s.userEnd != null && s.userEnd > s.userStart && layout.user) {
          const ux0 = xUser(s.userStart);
          const ux1 = xUser(s.userEnd);
          paintSlot(
            ctx,
            ux0,
            ux1,
            layout.user,
            i === selected,
            replayIndex === i && playingTrack === "yours",
            true,
          );
          clipDraw(ctx, layout.gutter, layout.user, layout.plotWidth, () => {
            drawLineInSlot(ctx, s.userSemitones, ux0, ux1, layout.user!, "#f3ead8", 2.2, axis);
          });
          userLabels.push({ index: i, hanzi: s.hanzi, x0: ux0, x1: ux1 });
        }
      });
      const plotLeft = layout.gutter;
      const plotRight = layout.gutter + layout.plotWidth;
      drawLaneLabels(ctx, modelLabels, layout.refLabels, family.hanzi, selected, plotLeft, plotRight);
      if (layout.userLabels) {
        drawLaneLabels(ctx, userLabels, layout.userLabels, family.hanzi, selected, plotLeft, plotRight);
      }

      if (playheadT != null) {
        const onUser = playingTrack === "yours" && layout.user;
        const band = onUser ? layout.user! : layout.ref;
        const x = onUser ? xUser(playheadT) : xModel(playheadT);
        ctx.strokeStyle = "#c44a32";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, band.top);
        ctx.lineTo(x, band.top + band.height);
        ctx.stroke();
      }
    };
    draw();
    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [
    refPitch,
    userPitch,
    syllables,
    playheadT,
    selected,
    replayIndex,
    playingTrack,
    replayTrack,
    axis,
    showUser,
    previousTake,
  ]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full min-w-0 flex-1"
      style={{ height: showUser ? 290 : 176 }}
      aria-label="Sentence pitch contour"
    />
  );
}

function SyllableCanvas({
  syllable,
  showUser,
  axis,
  durations,
}: {
  syllable?: SyllablePitch;
  showUser: boolean;
  axis: PitchAxis;
  durations: number[];
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !syllable) return;
    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!(width > 0) || !(height > 0)) return;
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

      const px = characterPxPerSec(width, durations);
      const modelDur = Math.max(0, syllable.end - syllable.start);
      const userDur =
        syllable.userStart != null && syllable.userEnd != null && syllable.userEnd > syllable.userStart
          ? syllable.userEnd - syllable.userStart
          : 0;
      const modelW = modelDur * px;
      const userW = userDur * px;
      const template = canonicalTone(syllable.expectedTone);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, width, height);
      ctx.clip();
      if (modelW > 1) {
        drawLine(ctx, template, modelW, height, "#8aa88f", 1.5, true, axis);
        drawLine(ctx, syllable.refSemitones, modelW, height, "#e8c27a", 2.4, false, axis);
      }
      if (showUser && userW > 1) {
        drawLine(ctx, syllable.userSemitones, userW, height, "#f3ead8", 3.2, false, axis);
      }
      ctx.restore();
    };
    draw();
    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [syllable, showUser, axis, durations]);

  return (
    <canvas
      ref={ref}
      className="h-full w-full"
      style={{ height: 148 }}
      aria-label="Pitch overlay for the selected syllable"
    />
  );
}

function canvasFont(): { hanzi: string; sans: string } {
  const hanzi = document.querySelector(".hanzi");
  const sans = document.querySelector("[class*='font-sans']");
  return {
    hanzi: hanzi ? getComputedStyle(hanzi).fontFamily : "serif",
    sans: sans ? getComputedStyle(sans).fontFamily : "sans-serif",
  };
}

function drawGrid(ctx: CanvasRenderingContext2D, x: number, width: number, band: PlotBand) {
  ctx.strokeStyle = "rgba(243, 234, 216, 0.08)";
  ctx.lineWidth = 1;
  for (const fraction of [0.25, 0.5, 0.75]) {
    const y = band.top + band.height * fraction;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width, y);
    ctx.stroke();
  }
}

function paintSlot(
  ctx: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  band: PlotBand,
  selected: boolean,
  playing: boolean,
  user = false,
) {
  if (playing) ctx.fillStyle = user ? "rgba(243, 234, 216, 0.28)" : "rgba(232, 194, 122, 0.32)";
  else if (selected) ctx.fillStyle = user ? "rgba(243, 234, 216, 0.08)" : "rgba(232, 194, 122, 0.12)";
  else return;
  ctx.fillRect(x0, band.top, Math.max(2, x1 - x0), band.height);
}

function clipDraw(
  ctx: CanvasRenderingContext2D,
  x: number,
  band: PlotBand,
  width: number,
  draw: () => void,
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, band.top, width, band.height);
  ctx.clip();
  draw();
  ctx.restore();
}

type LabelSlot = { index: number; hanzi: string; x0: number; x1: number };

function drawLaneLabels(
  ctx: CanvasRenderingContext2D,
  items: LabelSlot[],
  band: PlotBand,
  family: string,
  selected: number,
  left: number,
  right: number,
) {
  if (!items.length || band.height < 4) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, band.top, Math.max(1, right - left), band.height);
  ctx.clip();
  ctx.font = `14px ${family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const widths = items.map((item) => Math.max(12, ctx.measureText(item.hanzi).width));
  const centers = separateLabelCenters({
    ideal: items.map((item) => (item.x0 + item.x1) / 2),
    widths,
    left,
    right,
    minGap: LABEL_MIN_GAP,
  });
  const y = band.top + band.height / 2;
  items.forEach((item, i) => {
    if (item.index !== selected) return;
    ctx.fillStyle = "rgba(243, 234, 216, 0.16)";
    ctx.fillRect(item.x0, band.top, Math.max(2, item.x1 - item.x0), band.height);
  });
  items.forEach((item, i) => {
    const center = centers[i]!;
    const width = widths[i]!;
    if (item.index === selected) {
      ctx.fillStyle = "rgba(243, 234, 216, 0.22)";
      ctx.fillRect(center - width / 2 - 1, band.top, width + 2, band.height);
    }
    ctx.fillStyle = item.index === selected ? "rgba(243, 234, 216, 0.95)" : "rgba(243, 234, 216, 0.78)";
    ctx.fillText(item.hanzi, center, y);
  });
  ctx.restore();
}

function drawLineInSlot(
  ctx: CanvasRenderingContext2D,
  values: (number | null)[],
  x0: number,
  x1: number,
  band: PlotBand,
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
  strokeWithGaps(ctx, values, x, (value) => band.top + semitoneToY(value, band.height, axis));
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
