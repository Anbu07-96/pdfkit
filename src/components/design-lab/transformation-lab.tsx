"use client";

import * as React from "react";

/**
 * PHASE 75D.8 — shared design-lab chrome for transformation worlds.
 *
 * Visual R&D only: no workflow, no upload, no API, no production code.
 * Every world is a deterministic four-beat composition — START / MID /
 * RECONSTRUCT / COMPLETE — driven by `data-beat` on the lab root. Motion is
 * the CSS transition between authored beats, so screenshots freeze exact
 * visual states (the 75D.7 lesson: never trust timers for stills).
 *
 * PLAY sequences the beats on an interval (paused while the tab is hidden,
 * cleaned up on unmount). Controls are deliberately visually secondary.
 */

export type LabBeat = "start" | "mid" | "reconstruct" | "complete";
export const LAB_BEATS: LabBeat[] = ["start", "mid", "reconstruct", "complete"];

/* ------------------------------------------------------------------ */
/* Shared synthetic document (same information in every world)          */
/* ------------------------------------------------------------------ */

export const DOC = {
  eyebrow: "Operations · Q3 2026",
  title: "Quarterly Field Report",
  dek: "How 4,318 submissions found their shape — and what structure unlocks next.",
  paras: [
    "Field teams submitted 4,318 documents this quarter, up 12% from Q2. Intake quality improved in every region as the new validation pass rolled out in August.",
    "The northern districts led on turnaround, clearing 96% of submissions within a day. Southern teams followed closely, supported by the shared review desk brought online in July.",
    "Two figures anchor this report: a site survey completed in September, and the regional summary below. Together they show where capacity is concentrated.",
    "Next quarter's priority is consistent structure — every submission readable, searchable, and ready for downstream tools without manual cleanup.",
  ],
  tableCap: "Regional summary",
  tableHead: ["Region", "Documents", "On-time"],
  tableRows: [
    ["North", "1,486", "96%"],
    ["South", "1,212", "93%"],
    ["East", "984", "91%"],
    ["West", "636", "89%"],
  ],
  chartLabel: "Weekly intake",
  chartMeta: "wk 1–7 · peak 52k",
  chartPoints: [24, 31, 28, 42, 47, 44, 52],
  figCaption: "Fig. 1 — Field site, September survey.",
  meta: "14 paragraphs · 2 figures · 1 table · 4 pages",
};

/** Painted "photograph" (gradients + clip-path ridges — no assets). */
export function PhotoBlock({ className }: { className?: string }) {
  return (
    <figure className={className ? `tl-photo ${className}` : "tl-photo"}>
      <div className="tl-photo__img" aria-hidden="true">
        <span className="tl-photo__sun" />
        <span className="tl-photo__ridge tl-photo__ridge--far" />
        <span className="tl-photo__ridge tl-photo__ridge--near" />
      </div>
      <figcaption className="tl-photo__cap">{DOC.figCaption}</figcaption>
    </figure>
  );
}

/** Thin line chart with real numerals. */
export function ChartBlock({ className }: { className?: string }) {
  const pts = DOC.chartPoints;
  const W = 300;
  const H = 92;
  const px = (i: number) => 12 + (i / (pts.length - 1)) * (W - 24);
  const py = (v: number) => H - 10 - ((v - 20) / 36) * (H - 26);
  return (
    <div className={className ? `tl-chart ${className}` : "tl-chart"}>
      <span className="tl-chart__label">{DOC.chartLabel}</span>
      <svg viewBox={`0 0 ${W} ${H}`} className="tl-chart__svg" aria-hidden="true" focusable="false">
        <line x1="12" y1={H - 10} x2={W - 12} y2={H - 10} className="tl-chart__axis" />
        <polyline
          points={pts.map((v, i) => `${px(i)},${py(v)}`).join(" ")}
          className="tl-chart__line"
        />
        {pts.map((v, i) => (
          <circle key={i} cx={px(i)} cy={py(v)} r="2.4" className="tl-chart__dot" />
        ))}
      </svg>
      <span className="tl-chart__meta">{DOC.chartMeta}</span>
    </div>
  );
}

/** Rules-only data table (real values, tabular numerals). */
export function TableBlock({ className }: { className?: string }) {
  return (
    <table className={className ? `tl-table ${className}` : "tl-table"}>
      <caption className="tl-table__cap">{DOC.tableCap}</caption>
      <thead>
        <tr>
          {DOC.tableHead.map((h) => (
            <th key={h}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {DOC.tableRows.map((r) => (
          <tr key={r[0]}>
            {r.map((c, i) => (
              <td key={i}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ */
/* Pointer physics: one rAF loop, two custom properties, no rerenders   */
/* ------------------------------------------------------------------ */

export function useStagePhysics(ref: React.RefObject<HTMLElement | null>) {
  const rafRef = React.useRef(0);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const target = { x: 0, y: 0 };
    const cur = { x: 0, y: 0 };
    const loop = () => {
      rafRef.current = 0;
      cur.x += (target.x - cur.x) * 0.07;
      cur.y += (target.y - cur.y) * 0.07;
      el.style.setProperty("--px", cur.x.toFixed(4));
      el.style.setProperty("--py", cur.y.toFixed(4));
      if (Math.abs(target.x - cur.x) + Math.abs(target.y - cur.y) > 0.005) {
        rafRef.current = requestAnimationFrame(loop);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const r = el.getBoundingClientRect();
      target.x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      target.y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
      if (!rafRef.current) rafRef.current = requestAnimationFrame(loop);
    };
    el.addEventListener("pointermove", onMove);
    return () => {
      el.removeEventListener("pointermove", onMove);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [ref]);
}

/* ------------------------------------------------------------------ */
/* Lab shell                                                            */
/* ------------------------------------------------------------------ */

export interface TransformationLabProps {
  id: string;
  index: number;
  name: string;
  summary: string;
  children: React.ReactNode;
}

export function TransformationLab({ id, index, name, summary, children }: TransformationLabProps) {
  const [beat, setBeat] = React.useState<LabBeat>("start");
  const [playing, setPlaying] = React.useState(false);
  const [dark, setDark] = React.useState(false);
  const stageRef = React.useRef<HTMLDivElement>(null);
  useStagePhysics(stageRef);

  React.useEffect(() => {
    // Read the resolved theme once on mount (external DOM state — the
    // mount-sync pattern; a single intentional setState).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  React.useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => {
      if (document.hidden) return;
      setBeat((b) => LAB_BEATS[(LAB_BEATS.indexOf(b) + 1) % LAB_BEATS.length]);
    }, 2600);
    return () => window.clearInterval(t);
  }, [playing]);

  const toggleTheme = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      window.localStorage.setItem("pdfkit-theme", next ? "dark" : "light");
    } catch {
      /* storage unavailable — lab only, ignore */
    }
    setDark(next);
  };

  return (
    <div className={`tl-lab tl-lab--${id}`} data-beat={beat}>
      <div className="tl-head" role="note">
        <span className="tl-head__tag">Design Lab · transformation study {index}</span>
        <span className="tl-head__name">{name}</span>
        <span className="tl-head__summary">{summary}</span>
      </div>
      <div className="tl-stage" ref={stageRef}>
        <div className="tl-scene" aria-hidden="true">
          {children}
        </div>
      </div>
      <div className="tl-controls" role="group" aria-label="Transformation beat">
        {LAB_BEATS.map((b) => (
          <button
            key={b}
            type="button"
            className="tl-btn"
            aria-pressed={beat === b && !playing}
            onClick={() => {
              setPlaying(false);
              setBeat(b);
            }}
          >
            {b}
          </button>
        ))}
        <button
          type="button"
          className="tl-btn tl-btn--play"
          aria-pressed={playing}
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? "❙❙ pause" : "▶ play"}
        </button>
        <button type="button" className="tl-btn" aria-pressed={dark} onClick={toggleTheme}>
          {dark ? "☾ dark" : "☀ light"}
        </button>
      </div>
    </div>
  );
}
