import type { ReactNode } from "react";
import "./design-lab.css";

/**
 * Phase 75D.6R — isolated design-lab environment.
 *
 * Internal prototype workspace for visual direction studies. Never linked
 * from public navigation, never in the sitemap, disallowed in robots.txt.
 * Nothing here is production UI; the production PDF → Word tool keeps the
 * 75D.5 baseline until a direction is chosen by human review.
 */
export default function DesignLabLayout({ children }: { children: ReactNode }) {
  return <div className="dl-root">{children}</div>;
}
