"use client";

import { useEffect, useRef } from "react";
import { canonicalTone } from "@/lib/pitch";
import { toneName } from "@/lib/text";
import type { PitchPoint, SyllablePitch, ToneGraph } from "@/lib/types";

export function PitchGraph({
  graph,
  selected,
  playheadT,
  onSelect,
}: {
  graph: ToneGraph;
  selected: number;
  playheadT: number | null;
  onSelect: (index: number) => void;
}) {
  const syllable = graph.syllables[selected] ?? graph.syllables[0];
  const hasUserTake = graph.userPitch.some((p) => p.hz != null);
  const syllableHasUser = syllable?.userStart != null;

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
              {syllableHasUser && syllable.heardTone != null
                ? ` · yours ${toneName(syllable.heardTone)}`
                : ""}
              {hasUserTake ? toneVerdict(syllable) : ""}
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
          />
          <div className="w-36 shrink-0 sm:w-44">
            <SyllableCanvas syllable={syllable} showUser={syllableHasUser} />
          </div>
        </div>

        <div className="mt-1 flex flex-wrap gap-0.5">
          {graph.syllables.map((s, i) => (
            <button
              key={`${s.hanzi}-${i}`}
              type="button"
              onClick={() => onSelect(i)}
              className={`hanzi min-w-7 rounded px-1.5 py-0.5 text-base ${
                i === selected
                  ? "bg-paper text-ink"
                  : s.userStart == null && hasUserTake
                    ? "bg-white/10 text-paper/35 hover:bg-white/16"
                    : "bg-white/10 text-paper hover:bg-white/16"
              }`}
              title={`${s.pinyin} ${toneName(s.expectedTone)}`}
            >
              {s.hanzi}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function toneVerdict(s: SyllablePitch): string {
  if (s.userStart == null) return " · not in this take";
  if (s.expectedTone === 5) return " · light / short";
  if (s.heardTone == null) return " · no clear pitch — try closer to the mic";
  if (s.heardTone === s.expectedTone) return " · shape matches";
  return " · shape is off";
}

function SentenceCanvas({
  refPitch,
  userPitch,
  syllables,
  duration,
  playheadT,
  selected,
}: {
  refPitch: PitchPoint[];
  userPitch: PitchPoint[];
  syllables: SyllablePitch[];
  duration: number;
  playheadT: number | null;
  selected: number;
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
        if (i === selected) {
          ctx.fillStyle = "rgba(232, 194, 122, 0.12)";
          ctx.fillRect(x0, refTop, Math.max(2, x1 - x0), band);
        }
        ctx.fillStyle = "rgba(243, 234, 216, 0.5)";
        ctx.font = "12px 'Noto Serif SC', serif";
        ctx.fillText(s.hanzi, x0 + Math.max(2, (x1 - x0) / 2 - 6), refTop + 12);
        drawLineInSlot(ctx, s.refSemitones, x0, x1, refTop, band, "#e8c27a", 2.1);
      }
      if (s.userStart != null && s.userEnd != null && s.userEnd > s.userStart) {
        const ux0 = (s.userStart / span) * width;
        const ux1 = (s.userEnd / span) * width;
        if (i === selected) {
          ctx.fillStyle = "rgba(243, 234, 216, 0.08)";
          ctx.fillRect(ux0, userTop, Math.max(2, ux1 - ux0), band);
        }
        drawLineInSlot(
          ctx,
          s.userSemitones,
          ux0,
          ux1,
          userTop,
          band,
          "#f3ead8",
          2.2,
        );
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
  }, [refPitch, userPitch, syllables, duration, playheadT, selected]);

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
}: {
  syllable?: SyllablePitch;
  showUser: boolean;
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
    drawLine(ctx, template, width, height, "#8aa88f", 1.5, true);
    drawLine(ctx, syllable.refSemitones, width, height, "#e8c27a", 2.4, false);
    if (showUser) {
      drawLine(ctx, syllable.userSemitones, width, height, "#f3ead8", 3.2, false);
    }
  }, [syllable, showUser]);

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
) {
  const pts = values
    .map((v, i) => (v == null ? null : { i, v }))
    .filter((p): p is { i: number; v: number } => p != null);
  if (pts.length < 2) return;
  const span = Math.max(2, x1 - x0);
  const x = (i: number) => x0 + (i / Math.max(1, values.length - 1)) * span;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  pts.forEach((p, n) => {
    const y = yTop + semitoneY(p.v, bandH);
    if (n === 0) ctx.moveTo(x(p.i), y);
    else ctx.lineTo(x(p.i), y);
  });
  ctx.stroke();
  ctx.restore();
}

function semitoneY(v: number, height: number): number {
  const min = -4.5;
  const max = 4.5;
  return height - ((v - min) / (max - min)) * height;
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  values: (number | null)[],
  width: number,
  height: number,
  color: string,
  lineWidth: number,
  dashed: boolean,
) {
  const pts = values
    .map((v, i) => (v == null ? null : { i, v }))
    .filter((p): p is { i: number; v: number } => p != null);
  if (pts.length < 2) return;
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * width;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (dashed) ctx.setLineDash([5, 5]);
  ctx.beginPath();
  pts.forEach((p, n) => {
    if (n === 0) ctx.moveTo(x(p.i), semitoneY(p.v, height));
    else ctx.lineTo(x(p.i), semitoneY(p.v, height));
  });
  ctx.stroke();
  ctx.restore();
}
