import type { Metadata } from "next";
import { WorldGlass } from "@/components/design-lab/world-glass";
import "../../transformation-lab.css";

/** Phase 75D.8 — World 1 visual study (internal, noindex, mocked). */
export const metadata: Metadata = {
  title: "Design Lab — Information Glass (internal)",
  robots: { index: false, follow: false, nocache: true },
};

export default function InformationGlassPage() {
  return <WorldGlass />;
}
