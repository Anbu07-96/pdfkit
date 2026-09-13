import type { Metadata } from "next";
import { ConceptC } from "@/components/design-lab/concept-c";

export const metadata: Metadata = {
  title: "Design Lab — Concept C (internal)",
  robots: { index: false, follow: false, nocache: true },
};

export default function ConceptCPage() {
  return <ConceptC />;
}
