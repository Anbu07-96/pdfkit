import { TOOL_CATEGORIES } from "@/lib/tools";

export const siteConfig = {
  name: "PDFKit",
  tagline: "Your documents. Processed simply.",
  description:
    "PDFKit is a fast, privacy-conscious web app for everyday PDF and document tasks. The product is in early development — tools are being built and released one by one.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  /** Set NEXT_PUBLIC_CONTACT_EMAIL to override in a real deployment. */
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "",
} as const;

export interface NavLink {
  label: string;
  href: string;
  description?: string;
}

/** Primary navigation: one entry per tool category plus the full catalog. */
export const primaryNav: NavLink[] = [
  { label: "Tools", href: "/tools", description: "Browse the full catalog" },
  ...TOOL_CATEGORIES.filter((category) =>
    ["convert", "edit", "ocr", "ai"].includes(category.id),
  ).map((category) => ({
    label: category.shortName,
    href: category.route,
    description: category.description,
  })),
  { label: "Pricing", href: "/pricing", description: "Plans and availability" },
];

export interface FooterGroup {
  title: string;
  links: NavLink[];
}

export const footerNav: FooterGroup[] = [
  {
    title: "Product",
    links: [
      { label: "PDF tools", href: "/tools" },
      { label: "Convert", href: "/categories/convert" },
      { label: "Edit", href: "/categories/edit" },
      { label: "OCR", href: "/categories/ocr" },
      { label: "AI", href: "/categories/ai" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Help", href: "/help" },
      { label: "FAQ", href: "/faq" },
      { label: "Developer API", href: "/developers" },
      { label: "Roadmap", href: "/roadmap" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
];
