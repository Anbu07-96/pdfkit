import type { Metadata } from "next";
import { ContentPage } from "@/components/layout/content-page";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Roadmap",
  description:
    "What has been built in PDFKit so far and what is planned next. Only completed work is marked as done.",
};

const PHASES = [
  {
    title: "Phase 1 — Foundation and product shell",
    status: "Completed" as const,
    items: [
      "Next.js + TypeScript + Tailwind CSS foundation",
      "Design system, light and dark themes",
      "Application shell: navigation, layout, footer",
      "Homepage with search, popular tools, categories, privacy, FAQ",
      "Central tool catalog with 44 tools and honest availability states",
      "Processing contract defined with no implementation",
      "Reusable tool page template and upload interface (selection only)",
      "Automated tests for the catalog, search, theme and key components",
    ],
  },
  {
    title: "Phase 2 — First real PDF processing (Merge PDF)",
    status: "Completed" as const,
    items: [
      "Server-side processing layer: contract, registry, service and error model",
      "Merge PDF processor built on pdf-lib, running only on the server",
      "POST /api/tools/merge-pdf with multipart upload, size and count limits",
      "Server-side PDF signature validation — file names and MIME types are not trusted",
      "Merge workspace: ordering, removal, processing state, real download",
      "In-memory processing with no temporary files and no document logging",
    ],
  },
  {
    title: "Phase 3 — Page-level processing (Split PDF)",
    status: "Completed" as const,
    items: [
      "Reusable page selection model, range parser and validation (1-based)",
      "Server-authoritative page count via POST /api/documents/inspect",
      "Multi-artifact processing: one input, many output documents",
      "Split PDF processor: split every page, or split by page ranges",
      "ZIP delivery with sanitised entry names, plus a configurable output limit",
      "Split workspace with real page counts, live range validation and downloads",
    ],
  },
  {
    title: "Phase 4 — Extract and Delete PDF pages",
    status: "Completed" as const,
    items: [
      "Reusable page complement helper (pages kept when pages are removed)",
      "Extract PDF Pages: keep the selected pages, in the selected order",
      "Delete PDF Pages: remove the selected pages, keeping document order",
      "Zero-page output blocked in the browser and rejected by the server",
      "Both tools reuse the Phase 3 page selection, validation and inspection",
    ],
  },
  {
    title: "Phase 5 — Reorder PDF Pages and real page previews",
    status: "Completed" as const,
    items: [
      "Reusable server-side page rasteriser (pdfium via WebAssembly)",
      "POST /api/documents/thumbnails returning real page previews",
      "Page permutation model with strict validation (no missing, no duplicates)",
      "Reorder PDF Pages: visual page organiser with drag and keyboard controls",
      "Reusable PdfPageThumbnail component for future page tools",
    ],
  },
  {
    title: "Phase 6 — Rotate PDF and visual page selection",
    status: "Completed" as const,
    items: [
      "Rotate PDF: per-page and whole-document rotation, additive to any existing rotation",
      "Previews re-rendered by the server so they match what will be saved",
      "Visual page picker for Extract and Delete, synced with the range field",
      "Page previews as context in Split, keeping its tested range workflow",
      "Rotation model with strict 0/90/180/270 validation shared by UI and server",
    ],
  },
  {
    title: "Phase 7 — Compress PDF",
    status: "Completed" as const,
    items: [
      "Lossless structural and stream optimisation (pdf-lib + fflate)",
      "Aggressive mode that rasterises image-heavy pages (pdfium + JPEG)",
      "Honest before/after byte reporting — no saving is claimed without proof",
      "Neutral \u201calready well optimised\u201d result when nothing helps",
    ],
  },
  {
    title: "Phase 8 — Image ↔ PDF conversion",
    status: "Completed" as const,
    items: [
      "Images to PDF: JPG/JPEG/PNG, one page per image, your order, JPEG data untouched",
      "PDF to JPG and PDF to PNG at 150 DPI via the shared pdfium renderer",
      "One image for single pages, a ZIP per document otherwise",
      "Signature checks, pixel/page/output limits, all enforced server-side",
    ],
  },
  {
    title: "Phase 31 — Add Text",
    status: "Completed" as const,
    items: [
      "Real vector text boxes (multi-line, nine anchors, four sizes) — pages never rasterised",
      "Oversized text scaled down to fit; unencodable characters rejected plainly",
      "Stamped-page count measured server-side (X-PDFKit-Text-Pages)",
    ],
  },
  {
    title: "Phase 30 — Unlock PDF",
    status: "Completed" as const,
    items: [
      "Real decryption with a password you already have — not password recovery",
      "RC4 40-bit and 128-bit supported; AES-class files refused honestly",
      "Protect → unlock round trip verified end to end over both routes",
      "Wrong passwords reported, never echoed; unprotected input told apart from damaged files",
    ],
  },
  {
    title: "Phase 29 — Password Protect",
    status: "Completed" as const,
    items: [
      "Real RC4 128-bit encryption (Standard Security V2/R3) — opening requires the password",
      "Output verified three ways before download; already-encrypted files refused",
      "Honest labelling everywhere: RC4 named, AES-256 never claimed",
      "Password held in memory for the request only — never logged",
    ],
  },
  {
    title: "Phase 28 — Production hardening, wave 1",
    status: "Completed" as const,
    items: [
      "One hardened wrapper around every processing route",
      "Numeric Content-Length gate, optional concurrency cap (503, no queue)",
      "Request timeout (504) that never pretends to abort pdfium mid-render; CI workflow",
    ],
  },
  {
    title: "Phase 26 — Flatten PDF",
    status: "Completed" as const,
    items: [
      "Vector form flattening with pdf-lib — pages never rasterised",
      "Field values become permanent, selectable page content; links survive",
      "Signed PDFs rejected before any change — signatures are never destroyed",
      "pdf-lib's dangling widget references cleaned up; empty AcroForm removed",
      "Stated plainly: irreversible, and document scripts are NOT removed",
    ],
  },
  {
    title: "Phase 24 — Crop",
    status: "Completed" as const,
    items: [
      "CropBox only — MediaBox, content, rotation and order untouched",
      "Rectangle or margins, in points from a bottom-left origin",
      "Reject-never-clamp validation; per-page margins for mixed sizes",
      "Stated and proven: cropping hides content, it does not remove it",
    ],
  },
  {
    title: "Phase 22 — Page Numbers",
    status: "Completed" as const,
    items: [
      "Sequential numbers as visible vector text — no rasterising",
      "Position, starting number, font size, format and page choice",
      "Page X of Y always reports the real page count",
      "Server-validated options; numbered count reported honestly",
    ],
  },
  {
    title: "Phase 21 — Watermark",
    status: "Completed" as const,
    items: [
      "Vector text stamps with opacity, angle, placement and page choice",
      "Pages never rasterised — size, rotation and content untouched",
      "Server-validated options; stamped-page count reported honestly",
      "Stated plainly: a visible watermark deters, it does not protect",
    ],
  },
  {
    title: "Phase 17 — PNG to PDF",
    status: "Completed" as const,
    items: [
      "The shared image-to-PDF engine in PNG-only form, one page per image",
      "Transparency preserved as a soft mask over a white page background",
      "Non-PNG payloads rejected by real signature, whatever the name claims",
    ],
  },
  {
    title: "Phase 15 — PDF to Word (text only)",
    status: "Completed" as const,
    items: [
      "Every page's text extracted with the existing pdfium pipeline",
      "Real .docx output via the MIT-licensed docx generator, validated in memory",
      "Text-only semantics stated everywhere — no fake layout reconstruction",
      "Image-only PDFs honestly report zero extractable text",
    ],
  },
  {
    title: "Phase 12 — Metadata removal",
    status: "Completed" as const,
    items: [
      "Remove title, author, subject, keywords and creator in one verified step",
      "XMP stream removed from the object graph, bytes proven absent",
      "Honest library limits stated: creator emptied, producer/timestamps re-stamped",
      "Pages and content untouched",
    ],
  },
  {
    title: "Phase 11 — PDF metadata",
    status: "Completed" as const,
    items: [
      "Read document properties through the shared inspect endpoint",
      "Edit title, author, subject, keywords and creator; empty removes",
      "Producer and dates honestly read-only (pdf-lib re-stamps them)",
      "Unicode round-trips; removals proven by re-reading the output",
    ],
  },
  {
    title: "Later phases",
    status: "Planned" as const,
    items: [
      "More organise and convert tools",
      "Editing and security tools",
      "OCR",
      "AI document intelligence",
      "Accounts, storage, billing and a developer API",
    ],
  },
];

export default function RoadmapPage() {
  return (
    <ContentPage
      title="Roadmap"
      intro="PDFKit is built in phases. A feature is only listed as completed once it is actually in the product."
      breadcrumbs={[{ label: "Home", href: "/" }, { label: "Roadmap" }]}
    >
      <ol className="flex flex-col gap-6">
        {PHASES.map((phase) => (
          <li
            key={phase.title}
            className="rounded-xl border border-border bg-surface p-5 shadow-xs"
          >
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-base font-semibold text-foreground">{phase.title}</h2>
              <Badge tone={phase.status === "Completed" ? "success" : "neutral"}>
                {phase.status}
              </Badge>
            </div>
            <ul className="mt-3 flex list-disc flex-col gap-1.5 ps-5 text-sm text-muted">
              {phase.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </ContentPage>
  );
}
