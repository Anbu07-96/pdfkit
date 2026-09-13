import type { Metadata } from "next";
import { ConceptA } from "@/components/design-lab/concept-a";

export const metadata: Metadata = {
  title: "Design Lab — Concept A (internal)",
  robots: { index: false, follow: false, nocache: true },
};

export default function ConceptAPage() {
  return <ConceptA />;
}
