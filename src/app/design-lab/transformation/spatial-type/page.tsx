import type { Metadata } from "next";
import { WorldType } from "@/components/design-lab/world-type";
import "../../transformation-lab.css";

/** Phase 75D.8 — World 2 visual study (internal, noindex, mocked). */
export const metadata: Metadata = {
  title: "Design Lab — Spatial Typography (internal)",
  robots: { index: false, follow: false, nocache: true },
};

export default function SpatialTypePage() {
  return <WorldType />;
}
