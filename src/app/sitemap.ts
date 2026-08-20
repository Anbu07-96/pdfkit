import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/config/site";
import { TOOL_CATEGORIES, TOOLS } from "@/lib/tools";

const STATIC_ROUTES = [
  "/",
  "/tools",
  "/pricing",
  "/help",
  "/faq",
  "/developers",
  "/roadmap",
  "/privacy",
  "/terms",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteConfig.url.replace(/\/$/, "");
  const lastModified = new Date();

  return [
    ...STATIC_ROUTES.map((route) => ({
      url: `${base}${route}`,
      lastModified,
      priority: route === "/" ? 1 : 0.7,
    })),
    ...TOOL_CATEGORIES.map((category) => ({
      url: `${base}${category.route}`,
      lastModified,
      priority: 0.6,
    })),
    ...TOOLS.map((tool) => ({
      url: `${base}${tool.route}`,
      lastModified,
      priority: 0.5,
    })),
  ];
}
