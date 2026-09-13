import type { Metadata } from "next";
import { WorldMatter } from "@/components/design-lab/world-matter";
import "../../transformation-lab.css";

/** Phase 75D.8 — World 3 visual study (internal, noindex, mocked). */
export const metadata: Metadata = {
  title: "Design Lab — Document Matter (internal)",
  robots: { index: false, follow: false, nocache: true },
};

export default function DocumentMatterPage() {
  return <WorldMatter />;
}
