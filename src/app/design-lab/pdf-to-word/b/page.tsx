import type { Metadata } from "next";
import { ConceptB } from "@/components/design-lab/concept-b";

export const metadata: Metadata = {
  title: "Design Lab — Concept B (internal)",
  robots: { index: false, follow: false, nocache: true },
};

export default function ConceptBPage() {
  return <ConceptB />;
}
