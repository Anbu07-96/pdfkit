import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/config/site";

export default function robots(): MetadataRoute.Robots {
  const base = siteConfig.url.replace(/\/$/, "");
  return {
    rules: [
      { userAgent: "*", allow: "/" },
      // Internal design-lab prototypes must never be indexed.
      { userAgent: "*", disallow: "/design-lab" },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
