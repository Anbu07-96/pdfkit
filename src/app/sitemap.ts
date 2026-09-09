import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/config/site";
import { BULK_OPERATIONS } from "@/lib/tools/bulk";
import { TOOL_CATEGORIES, TOOLS } from "@/lib/tools";

const STATIC_ROUTES = [
  "/",
  "/tools",
  "/bulk",
  "/pricing",
  "/help",
  "/faq",
  "/developers",
  "/roadmap",
  "/privacy",
  "/terms",
  "/security",
  "/contact",
  "/refund-policy",
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
    ...BULK_OPERATIONS.map((operation) => ({
      url: `${base}${operation.route}`,
      lastModified,
      priority: 0.5,
    })),
  ];
}
