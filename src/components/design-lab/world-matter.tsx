"use client";

import * as React from "react";
import { TransformationLab } from "./transformation-lab";

/**
 * WORLD 3 — "Document Matter" (Phase 75D.8 visual R&D).
 *
 * The document as structured digital matter: 43 authored fragments — heading
 * chips, paragraph strips with real text, six tiles that are slices of one
 * photograph, table-cell chips with real values, page-boundary frames, layout
 * anchors — assembled as a document-shaped mass, released along three
 * streamlines through a volumetric light column, and docked into a forming
 * Word structure. Positions for every beat are computed deterministically
 * (no Math.random, no timers); motion is the CSS transition between beats.
 */

type Kind = "head" | "strip" | "tile" | "cell" | "frame" | "anchor";

interface Frag {
  key: string;
  cls: string;
  label?: string;
  w: number;
  h: number;
  s: [number, number];
  e: [number, number];
  rm: number;
  d: number;
  /** tile slice position within the shared photo (col,row of 2×3) */
  pos?: string;
}

const STRIP_TEXT = [
  "Field teams submitted 4,318 documents this quarter, up",
  "12% from Q2. Intake quality improved in every",
  "region as the new validation pass rolled out in",
  "August. The northern districts led on turnaround,",
  "clearing 96% of submissions within a day.",
  "Southern teams followed closely, supported by",
  "the shared review desk brought online in July.",
  "Two figures anchor this report: a site survey",
  "completed in September, and the summary below.",
  "Next quarter's priority is consistent structure —",
  "every submission readable, searchable, ready.",
];

const CELL_TEXT = [
  "Region", "Documents", "On-time",
  "North", "1,486", "96%",
  "South", "1,212", "93%",
  "East", "984", "91%",
];

const HEADS: Array<[string, number, number, number, number, number, number, number, number]> = [
  // label, sx, sy, sw, sh, ex, ey, ew, eh
  ["Q3 2026", 245, 148, 86, 18, 790, 130, 86, 18],
  ["Quarterly", 272, 184, 126, 30, 828, 168, 126, 30],
  ["Field Report", 300, 218, 150, 30, 830, 200, 150, 30],
  ["Operations", 272, 248, 110, 18, 792, 228, 110, 18],
];

const T: Record<Kind, number> = { head: 0.42, strip: 0.38, tile: 0.5, cell: 0.46, frame: 0.3, anchor: 0.5 };
const AMP: Record<Kind, number> = { head: -65, strip: 72, tile: -82, cell: 84, frame: 48, anchor: 26 };
const RM: Record<Kind, number> = { head: 0.06, strip: 0.16, tile: -0.12, cell: 0.1, frame: 0.05, anchor: 0 };

function buildFrags(): Frag[] {
  const frags: Frag[] = [];
  let i = 0;

  const push = (kind: Kind, w: number, h: number, s: [number, number], e: [number, number], label?: string, pos?: string) => {
    frags.push({
      key: `${kind}-${i}`,
      cls: `wm-frag wm-${kind}`,
      label,
      w,
      h,
      s,
      e,
      rm: RM[kind] + (i % 2 ? 0.05 : -0.05),
      d: kind === "strip" ? 0.03 + (i % 11) * 0.012 : kind === "tile" ? 0.06 + (i % 6) * 0.01 : kind === "cell" ? 0.08 + (i % 12) * 0.008 : kind === "anchor" ? 0.1 : kind === "frame" ? 0.02 : 0,
      pos,
    });
    i += 1;
  };

  HEADS.forEach((hd) => push("head", hd[3], hd[4], [hd[1], hd[2]], [hd[5], hd[6]], hd[0]));

  const stripsSrc: Array<[number, number, number]> = [
    [300, 268, 160], [300, 284, 150], [292, 300, 166], [300, 316, 140],
    [350, 340, 158], [352, 356, 146], [348, 372, 164], [350, 388, 150], [348, 404, 136],
    [300, 522, 150], [285, 536, 120],
  ];
  const stripsDst: Array<[number, number, number]> = [
    [760, 262, 150], [905, 262, 130],
    [755, 284, 140], [895, 284, 150],
    [760, 306, 160], [910, 306, 120],
    [735, 328, 120], [850, 328, 140], [955, 328, 90],
    [770, 350, 150], [910, 350, 110],
  ];
  stripsSrc.forEach((sp, k) => push("strip", sp[2], 13, [sp[0], sp[1]], [stripsDst[k][0], stripsDst[k][1]], STRIP_TEXT[k]));

  const tileSrc: Array<[number, number]> = [[143, 356], [199, 356], [143, 420], [199, 420], [143, 484], [199, 484]];
  const tileDst: Array<[number, number]> = [[707, 392], [763, 392], [707, 456], [763, 456], [707, 520], [763, 520]];
  tileSrc.forEach((tp, k) => {
    const col = k % 2;
    const row = Math.floor(k / 2);
    push("tile", 56, 56, tp, tileDst[k], undefined, `${col * 100}% ${row * 100}%`);
  });

  const cellSrc: Array<[number, number]> = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) cellSrc.push([331 + c * 64, 421 + r * 28]);
  const cellDst: Array<[number, number]> = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) cellDst.push([859 + c * 64, 406 + r * 28]);
  cellSrc.forEach((cp, k) => push("cell", 58, 20, cp, cellDst[k], CELL_TEXT[k]));

  const frameOff: Array<[number, number]> = [[0, 0], [7, 5], [14, 10], [21, 15]];
  frameOff.forEach((fo) => push("frame", 356, 456, [300 + fo[0], 310 + fo[1]], [830 + fo[0], 310 + fo[1]]));

  const anchorSrc: Array<[number, number]> = [[125, 85], [475, 85], [125, 535], [475, 535], [125, 310], [475, 310]];
  const anchorDst: Array<[number, number]> = [[645, 75], [1015, 75], [645, 545], [1015, 545], [645, 310], [1015, 310]];
  anchorSrc.forEach((ap, k) => push("anchor", 10, 10, ap, anchorDst[k]));

  return frags;
}

/** Compute all four beat coordinates for a fragment (deterministic). */
function fragVars(f: Frag): React.CSSProperties {
  const [sx, sy] = f.s;
  const [ex, ey] = f.e;
  const kind = f.cls.split(" ")[1].replace("wm-", "") as Kind;
  const t = T[kind];
  const dx = ex - sx;
  const dy = ey - sy;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const jx = ((parseInt(f.key.split("-")[1], 10) % 5) - 2) * 20;
  const jy = ((parseInt(f.key.split("-")[1], 10) % 3) - 1) * 26;
  const mx = sx + dx * t + px * AMP[kind] + jx;
  const my = sy + dy * t + py * AMP[kind] + jy;
  const rx = ex + (sx - ex) * 0.1;
  const ry = ey + (sy - ey) * 0.1;
  const isTile = kind === "tile";
  const style: Record<string, string> = {
    "--sx": `${sx}px`, "--sy": `${sy}px`, "--sr": "0deg", "--ss": "1",
    "--mx": `${mx}px`, "--my": `${my}px`, "--mr": `${f.rm}rad`, "--ms": isTile ? "1.08" : "1.04",
    "--rx": `${rx}px`, "--ry": `${ry}px`, "--rr": `${f.rm * 0.25}rad`, "--rs": isTile ? "0.92" : "1",
    "--ex": `${ex}px`, "--ey": `${ey}px`, "--er": "0deg", "--es": isTile ? "0.857" : "1",
    "--d": `${f.d}s`,
    width: `${f.w}px`,
    height: `${f.h}px`,
  };
  if (f.pos) style["--pos"] = f.pos;
  if (kind === "head" && f.h <= 20) style["fontSize"] = "8.5px";
  return style as React.CSSProperties;
}

export function WorldMatter() {
  const frags = React.useMemo(() => buildFrags(), []);
  return (
    <TransformationLab
      id="matter"
      index={3}
      name="Document Matter"
      summary="the document as structured digital matter — fragments flow, reorganize, dock"
    >
      <div className="wm-world">
      {/* environment */}
      <div className="wm-env">
        <div className="wm-env__light" />
        <div className="wm-env__floor" />
        <div className="wm-env__vignette" />
      </div>

      {/* streamlines (visible during flight) */}
      <svg className="wm-lanes" viewBox="0 0 1160 620" aria-hidden="true" focusable="false">
        <path d="M 300 200 C 520 110, 720 150, 830 170" />
        <path d="M 300 310 C 500 260, 640 420, 830 310" />
        <path d="M 300 430 C 480 520, 680 480, 830 450" />
      </svg>

      {/* source mass ghost + destination frame */}
      <div className="wm-src" />
      <div className="wm-dst" />
      <div className="wm-dstdetail">
        <span className="wm-dstdetail__rule" />
        <span className="wm-dstdetail__rule wm-dstdetail__rule--2" />
        <span className="wm-dstdetail__block" />
      </div>

      {/* fragments */}
      {frags.map((f) => (
        <span
          key={f.key}
          className={`${f.cls}${f.cls.includes("wm-head") && f.h <= 20 ? " wm-head--eyebrow" : ""}`}
          style={fragVars(f)}
        >
          {f.label ?? null}
        </span>
      ))}
      </div>
    </TransformationLab>
  );
}
