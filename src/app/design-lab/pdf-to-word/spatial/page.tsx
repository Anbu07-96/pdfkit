import type { Metadata } from "next";
import { SpatialEngine } from "@/components/design-lab/spatial-engine";
import "../../spatial-engine.css";

/**
 * Phase 75D.7 — "Spatial Document Engine" design-lab experiment.
 *
 * Isolated interaction prototype (noindex, robots-disallowed, absent from
 * navigation and the catalog-driven sitemap). All workflow states are
 * mocked; the production PDF → Word tool keeps the 75D.5 baseline.
 */
export const metadata: Metadata = {
  title: "Design Lab — Spatial Document Engine (internal)",
  robots: { index: false, follow: false, nocache: true },
};

export default function SpatialPage() {
  return <SpatialEngine />;
}
