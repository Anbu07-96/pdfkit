import type { Tool } from "./types";

/**
 * Single source of truth for every PDFKit tool.
 *
 * Everything else in the application — homepage, search, category pages,
 * navigation, footer and tool pages — reads from this array. Nothing here is
 * duplicated anywhere else.
 *
 * IMPORTANT: no tool may be marked `AVAILABLE` until its processing is really
 * implemented. A tool is only `AVAILABLE` when it has a registered processor in
 * `src/lib/processing/registry.ts`; a test enforces that both sides agree.
 *
 * Implemented today: Merge PDF, Split PDF, Extract PDF Pages, Delete PDF Pages,
 * Reorder PDF Pages, Rotate PDF, Compress PDF, Images to PDF, PDF to JPG and
 * PDF to PNG. Everything else is `COMING_SOON`.
 */

const PDF_EXT = [".pdf"];
const PDF_MIME = ["application/pdf"];

function pdfTool(
  tool: Omit<Tool, "supportedFileTypes" | "acceptedMimeTypes" | "route" | "status"> &
    Partial<Pick<Tool, "supportedFileTypes" | "acceptedMimeTypes" | "status">>,
): Tool {
  return {
    route: `/tools/${tool.id}`,
    status: "COMING_SOON",
    supportedFileTypes: PDF_EXT,
    acceptedMimeTypes: PDF_MIME,
    ...tool,
  };
}

export const TOOLS: readonly Tool[] = [
  /* ------------------------------------------------------------------ */
  /* Organize PDF                                                        */
  /* ------------------------------------------------------------------ */
  pdfTool({
    id: "merge-pdf",
    name: "Merge PDF",
    description: "Combine multiple PDF files into one ordered document.",
    category: "organize",
    icon: "merge",
    // Implemented in Phase 2: server-side merging with pdf-lib.
    status: "AVAILABLE",
    plannedTier: "free",
    keywords: ["combine", "join", "concatenate", "append"],
    howItWorks: [
      "Add the PDF files you want to combine.",
      "Arrange them in the order the final document should follow.",
      "Merge them and download a single PDF.",
    ],
  }),
  pdfTool({
    id: "split-pdf",
    name: "Split PDF",
    description: "Divide one PDF into separate documents by page ranges.",
    category: "organize",
    icon: "split",
    // Implemented in Phase 3: server-side splitting with pdf-lib.
    status: "AVAILABLE",
    plannedTier: "free",
    keywords: ["divide", "separate", "cut", "ranges", "pages", "extract"],
    howItWorks: [
      "Upload the PDF you want to split.",
      "Split every page, or enter page ranges such as 1-3, 4-6.",
      "Download the resulting PDFs.",
    ],
  }),
  pdfTool({
    id: "compress-pdf",
    name: "Compress PDF",
    description: "Reduce PDF file size while keeping the document readable.",
    category: "organize",
    icon: "compress",
    // Implemented in Phase 7: lossless structural/stream optimisation with
    // pdf-lib + fflate, plus an optional aggressive pdfium + JPEG pass.
    status: "AVAILABLE",
    plannedTier: "free",
    keywords: ["optimize", "shrink", "reduce size", "smaller"],
    howItWorks: [
      "Upload the PDF you want to make smaller.",
      "Pick how strongly the file should be compressed.",
      "Download the optimised document.",
    ],
  }),
  pdfTool({
    id: "rotate-pdf",
    name: "Rotate PDF",
    description: "Turn selected pages so every page faces the right way.",
    category: "organize",
    icon: "rotate",
    // Implemented in Phase 6: server-side rotation with real page previews.
    status: "AVAILABLE",
    plannedTier: "free",
    keywords: ["turn", "orientation", "landscape", "portrait", "sideways"],
    howItWorks: [
      "Upload the PDF with pages facing the wrong way.",
      "Rotate individual pages, or rotate them all at once.",
      "Download the corrected PDF.",
    ],
  }),
  pdfTool({
    id: "delete-pdf-pages",
    name: "Delete PDF Pages",
    description: "Remove pages you do not need from a PDF document.",
    category: "organize",
    icon: "trash",
    // Implemented in Phase 4: server-side page removal with pdf-lib.
    status: "AVAILABLE",
    plannedTier: "free",
    keywords: ["remove pages", "erase", "drop pages", "delete"],
    howItWorks: [
      "Upload your PDF.",
      "Enter the pages to remove, such as 2, 4, 7-9.",
      "Download the PDF without those pages.",
    ],
  }),
  pdfTool({
    id: "reorder-pdf-pages",
    name: "Reorder PDF Pages",
    description: "Drag pages into a new order inside the same document.",
    category: "organize",
    icon: "reorder",
    // Implemented in Phase 5: server-side reordering with real page previews.
    status: "AVAILABLE",
    plannedTier: "free",
    keywords: ["rearrange", "sort pages", "move pages", "organise", "organize"],
    howItWorks: [
      "Upload your PDF and see a preview of every page.",
      "Drag the pages, or use the arrow buttons, until the order is right.",
      "Download the reordered document.",
    ],
  }),
  pdfTool({
    id: "extract-pdf-pages",
    name: "Extract PDF Pages",
    description: "Pull selected pages out of a PDF into a new file.",
    category: "organize",
    icon: "extract",
    // Implemented in Phase 4: server-side page extraction with pdf-lib.
    status: "AVAILABLE",
    plannedTier: "free",
    keywords: ["pick pages", "copy pages", "subset", "keep pages"],
    howItWorks: [
      "Upload the source PDF.",
      "Enter the pages to keep, such as 1-3, 5, 8-10.",
      "Download them as one new PDF.",
    ],
  }),

  /* ------------------------------------------------------------------ */
  /* Convert                                                             */
  /* ------------------------------------------------------------------ */
  pdfTool({
    id: "images-to-pdf",
    name: "Images to PDF",
    description: "Turn JPG and PNG images into a single PDF document.",
    category: "convert",
    icon: "image",
    // Implemented in Phase 8: server-side embedding with pdf-lib (JPEG data
    // is passed through untouched; PNG transparency is preserved on a white
    // page background).
    status: "AVAILABLE",
    plannedTier: "free",
    supportedFileTypes: [".jpg", ".jpeg", ".png"],
    acceptedMimeTypes: ["image/jpeg", "image/png"],
    keywords: ["jpeg", "photo", "picture", "image to pdf", "png to pdf", "jpg to pdf"],
    howItWorks: [
      "Add the JPG or PNG images you want to include.",
      "Arrange them in the order the pages should follow.",
      "Download one PDF with exactly one page per image.",
    ],
  }),
  pdfTool({
    id: "png-to-pdf",
    name: "PNG to PDF",
    description: "Turn PNG images into a single PDF document.",
    category: "convert",
    icon: "image",
    plannedTier: "free",
    supportedFileTypes: [".png"],
    acceptedMimeTypes: ["image/png"],
    keywords: ["screenshot", "picture", "image to pdf", "transparent"],
    howItWorks: [
      "Add the PNG images you want to include.",
      "Order them and choose page size and margins.",
      "Download the images as one PDF.",
    ],
  }),
  pdfTool({
    id: "pdf-to-jpg",
    name: "PDF to JPG",
    description: "Export every page of a PDF as a JPG image.",
    category: "convert",
    icon: "image",
    // Implemented in Phase 8: pdfium renders each page at the configured
    // export resolution; jpeg-js encodes at quality 90.
    status: "AVAILABLE",
    plannedTier: "free",
    keywords: ["jpeg", "export images", "page images", "screenshot"],
    howItWorks: [
      "Upload the PDF you want to export.",
      "Every page is rendered at 150 DPI (server-configurable).",
      "Download one JPG, or a ZIP with one JPG per page.",
    ],
  }),
  pdfTool({
    id: "pdf-to-png",
    name: "PDF to PNG",
    description: "Export PDF pages as lossless PNG images.",
    category: "convert",
    icon: "image",
    // Implemented in Phase 8: pdfium renders each page; the in-house PNG
    // encoder writes exact RGBA pixels.
    status: "AVAILABLE",
    plannedTier: "free",
    keywords: ["export images", "page images", "lossless"],
    howItWorks: [
      "Upload the PDF you want to export.",
      "Every page is rendered at 150 DPI (server-configurable).",
      "Download one PNG, or a ZIP with one PNG per page.",
    ],
  }),
  pdfTool({
    id: "pdf-to-word",
    name: "PDF to Word",
    description: "Convert a PDF into an editable Word document.",
    category: "convert",
    icon: "word",
    plannedTier: "free",
    keywords: ["docx", "editable", "microsoft word"],
    howItWorks: [
      "Upload the PDF you want to edit as text.",
      "PDFKit rebuilds the layout as a Word document.",
      "Download the .docx file.",
    ],
  }),
  pdfTool({
    id: "word-to-pdf",
    name: "Word to PDF",
    description: "Convert Word documents into shareable PDF files.",
    category: "convert",
    icon: "word",
    plannedTier: "free",
    supportedFileTypes: [".doc", ".docx"],
    acceptedMimeTypes: [
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    keywords: ["docx", "microsoft word", "document to pdf"],
    howItWorks: [
      "Upload your .doc or .docx file.",
      "PDFKit renders it with the original layout.",
      "Download the PDF.",
    ],
  }),
  pdfTool({
    id: "pdf-to-excel",
    name: "PDF to Excel",
    description: "Turn tables inside a PDF into an Excel spreadsheet.",
    category: "convert",
    icon: "excel",
    plannedTier: "free",
    keywords: ["xlsx", "spreadsheet", "tables", "data"],
    howItWorks: [
      "Upload a PDF that contains tabular data.",
      "Check the detected tables.",
      "Download the .xlsx spreadsheet.",
    ],
  }),
  pdfTool({
    id: "excel-to-pdf",
    name: "Excel to PDF",
    description: "Convert spreadsheets into clean, printable PDFs.",
    category: "convert",
    icon: "excel",
    plannedTier: "free",
    supportedFileTypes: [".xls", ".xlsx"],
    acceptedMimeTypes: [
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    keywords: ["xlsx", "spreadsheet", "sheet to pdf"],
    howItWorks: [
      "Upload your .xls or .xlsx file.",
      "Choose orientation and scaling.",
      "Download the PDF.",
    ],
  }),
  pdfTool({
    id: "powerpoint-to-pdf",
    name: "PowerPoint to PDF",
    description: "Convert slide decks into PDFs that open anywhere.",
    category: "convert",
    icon: "powerpoint",
    plannedTier: "free",
    supportedFileTypes: [".ppt", ".pptx"],
    acceptedMimeTypes: [
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
    keywords: ["pptx", "slides", "presentation", "deck"],
    howItWorks: [
      "Upload your .ppt or .pptx deck.",
      "Choose whether to include speaker notes.",
      "Download the PDF.",
    ],
  }),

  /* ------------------------------------------------------------------ */
  /* Edit PDF                                                            */
  /* ------------------------------------------------------------------ */
  pdfTool({
    id: "add-text",
    name: "Add Text",
    description: "Place new text boxes anywhere on a PDF page.",
    category: "edit",
    icon: "text",
    plannedTier: "free",
    keywords: ["write", "type", "fill form", "insert text"],
    howItWorks: [
      "Upload the PDF you want to write on.",
      "Add and position text boxes on any page.",
      "Download the edited PDF.",
    ],
  }),
  pdfTool({
    id: "add-images",
    name: "Add Images",
    description: "Insert logos, photos or stamps into a PDF page.",
    category: "edit",
    icon: "image",
    plannedTier: "free",
    keywords: ["insert image", "logo", "stamp", "picture"],
    howItWorks: [
      "Upload the PDF and the images you want to place.",
      "Position and resize each image.",
      "Download the edited PDF.",
    ],
  }),
  pdfTool({
    id: "draw",
    name: "Draw",
    description: "Draw freehand lines and marks directly on a document.",
    category: "edit",
    icon: "draw",
    plannedTier: "free",
    keywords: ["freehand", "pen", "sketch", "sign by hand"],
    howItWorks: [
      "Upload your PDF.",
      "Draw on the page with the pen tool.",
      "Download the edited PDF.",
    ],
  }),
  pdfTool({
    id: "highlight",
    name: "Highlight",
    description: "Mark important passages with a highlighter.",
    category: "edit",
    icon: "highlight",
    plannedTier: "free",
    keywords: ["marker", "emphasise", "colour text"],
    howItWorks: [
      "Upload your PDF.",
      "Select the text or area you want to highlight.",
      "Download the marked-up PDF.",
    ],
  }),
  pdfTool({
    id: "add-shapes",
    name: "Add Shapes",
    description: "Add rectangles, circles, lines and arrows to a page.",
    category: "edit",
    icon: "shapes",
    plannedTier: "free",
    keywords: ["rectangle", "circle", "arrow", "line", "box"],
    howItWorks: [
      "Upload your PDF.",
      "Draw shapes and set their colour and thickness.",
      "Download the edited PDF.",
    ],
  }),
  pdfTool({
    id: "watermark",
    name: "Watermark",
    description: "Stamp text or an image across the pages of a PDF.",
    category: "edit",
    icon: "watermark",
    plannedTier: "free",
    keywords: ["stamp", "draft", "confidential", "branding"],
    howItWorks: [
      "Upload your PDF.",
      "Choose the watermark text or image, position and opacity.",
      "Download the watermarked PDF.",
    ],
  }),
  pdfTool({
    id: "page-numbers",
    name: "Page Numbers",
    description: "Add page numbers with the position and format you choose.",
    category: "edit",
    icon: "page-numbers",
    plannedTier: "free",
    keywords: ["pagination", "numbering", "footer", "header"],
    howItWorks: [
      "Upload your PDF.",
      "Pick the position, starting number and format.",
      "Download the numbered PDF.",
    ],
  }),
  pdfTool({
    id: "crop",
    name: "Crop",
    description: "Trim margins and crop pages to a new size.",
    category: "edit",
    icon: "crop",
    plannedTier: "free",
    keywords: ["trim", "margins", "resize page", "cut edges"],
    howItWorks: [
      "Upload your PDF.",
      "Drag the crop area over the pages.",
      "Download the cropped PDF.",
    ],
  }),
  pdfTool({
    id: "annotations",
    name: "Annotations",
    description: "Add comments and notes for review and feedback.",
    category: "edit",
    icon: "annotate",
    plannedTier: "free",
    keywords: ["comment", "notes", "review", "feedback", "sticky note"],
    howItWorks: [
      "Upload the PDF you are reviewing.",
      "Attach comments to specific places on the page.",
      "Download the annotated PDF.",
    ],
  }),

  /* ------------------------------------------------------------------ */
  /* Security                                                            */
  /* ------------------------------------------------------------------ */
  pdfTool({
    id: "password-protect",
    name: "Password Protect",
    description: "Encrypt a PDF so only people with the password can open it.",
    category: "security",
    icon: "lock",
    plannedTier: "free",
    keywords: ["encrypt", "password", "secure", "protect"],
    howItWorks: [
      "Upload the PDF you want to protect.",
      "Set a password and the permissions you want to allow.",
      "Download the encrypted PDF.",
    ],
  }),
  pdfTool({
    id: "unlock-pdf",
    name: "Unlock PDF",
    description: "Remove a password you own from a protected PDF.",
    category: "security",
    icon: "unlock",
    plannedTier: "free",
    keywords: ["decrypt", "remove password", "open protected"],
    howItWorks: [
      "Upload the protected PDF.",
      "Enter the password you already have for the file.",
      "Download the unlocked PDF.",
    ],
  }),
  pdfTool({
    id: "redact-information",
    name: "Redact Information",
    description: "Permanently black out sensitive text and areas.",
    category: "security",
    icon: "redact",
    plannedTier: "free",
    keywords: ["black out", "hide", "censor", "sensitive", "gdpr"],
    howItWorks: [
      "Upload the document that contains sensitive content.",
      "Mark the text or areas to redact.",
      "Download a PDF with that content removed, not just covered.",
    ],
  }),
  pdfTool({
    id: "digital-signature",
    name: "Digital Signature",
    description: "Sign a document or request a signature from someone else.",
    category: "security",
    icon: "signature",
    plannedTier: "pro",
    keywords: ["esign", "sign", "signature", "contract"],
    howItWorks: [
      "Upload the document to sign.",
      "Place the signature fields on the page.",
      "Download the signed PDF.",
    ],
  }),
  pdfTool({
    id: "remove-metadata",
    name: "Remove Metadata",
    description: "Strip author, timestamps and other hidden document data.",
    category: "security",
    icon: "metadata",
    plannedTier: "free",
    keywords: ["privacy", "exif", "clean", "author", "hidden data"],
    howItWorks: [
      "Upload your PDF.",
      "Review the metadata found in the file.",
      "Download a copy with that metadata removed.",
    ],
  }),

  /* ------------------------------------------------------------------ */
  /* OCR                                                                 */
  /* ------------------------------------------------------------------ */
  pdfTool({
    id: "image-to-text",
    name: "Image to Text",
    description: "Read the text contained in a photo or screenshot.",
    category: "ocr",
    icon: "scan",
    plannedTier: "free",
    supportedFileTypes: [".jpg", ".jpeg", ".png", ".webp"],
    acceptedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    keywords: ["ocr", "recognise text", "extract text", "photo"],
    howItWorks: [
      "Upload an image that contains text.",
      "Choose the language of the document.",
      "Copy or download the recognised text.",
    ],
  }),
  pdfTool({
    id: "scanned-pdf-to-searchable-pdf",
    name: "Scanned PDF to Searchable PDF",
    description: "Add a text layer to a scan so it becomes searchable.",
    category: "ocr",
    icon: "scan",
    plannedTier: "free",
    keywords: ["ocr", "searchable", "scan", "text layer", "index"],
    howItWorks: [
      "Upload a scanned PDF.",
      "Choose the document language.",
      "Download a PDF whose text can be searched and selected.",
    ],
  }),
  pdfTool({
    id: "ocr-document",
    name: "OCR Document",
    description: "Extract plain text from a document for reuse elsewhere.",
    category: "ocr",
    icon: "text",
    plannedTier: "free",
    supportedFileTypes: [".pdf", ".jpg", ".jpeg", ".png"],
    acceptedMimeTypes: ["application/pdf", "image/jpeg", "image/png"],
    keywords: ["ocr", "text extraction", "recognise", "plain text"],
    howItWorks: [
      "Upload a PDF or image.",
      "Choose the document language.",
      "Download the extracted text.",
    ],
  }),

  /* ------------------------------------------------------------------ */
  /* AI                                                                  */
  /* ------------------------------------------------------------------ */
  pdfTool({
    id: "summarize-pdf",
    name: "Summarize PDF",
    description: "Get a short summary of a long document.",
    category: "ai",
    icon: "ai-summarize",
    plannedTier: "pro",
    keywords: ["summary", "tldr", "shorten", "overview", "ai"],
    howItWorks: [
      "Upload the document you need to understand quickly.",
      "Choose how detailed the summary should be.",
      "Read or download the summary.",
    ],
  }),
  pdfTool({
    id: "ask-pdf",
    name: "Ask PDF",
    description: "Ask questions about a document and get sourced answers.",
    category: "ai",
    icon: "ask",
    plannedTier: "pro",
    keywords: ["chat", "question", "ai", "q&a", "search document"],
    howItWorks: [
      "Upload the document you have questions about.",
      "Ask a question in plain language.",
      "Read the answer with references to the pages it came from.",
    ],
  }),
  pdfTool({
    id: "extract-important-information",
    name: "Extract Important Information",
    description: "Pull out the key facts, names and figures from a document.",
    category: "ai",
    icon: "key-points",
    plannedTier: "pro",
    keywords: ["entities", "facts", "data extraction", "ai", "fields"],
    howItWorks: [
      "Upload the document.",
      "Choose the kind of information you need.",
      "Review and export the extracted fields.",
    ],
  }),
  pdfTool({
    id: "extract-tables",
    name: "Extract Tables",
    description: "Detect tables in a document and export them as data.",
    category: "ai",
    icon: "table",
    plannedTier: "pro",
    keywords: ["csv", "spreadsheet", "rows", "columns", "data"],
    howItWorks: [
      "Upload a document containing tables.",
      "Check the detected table boundaries.",
      "Export the tables as CSV or XLSX.",
    ],
  }),
  pdfTool({
    id: "generate-notes",
    name: "Generate Notes",
    description: "Turn a document into structured study or meeting notes.",
    category: "ai",
    icon: "ai-notes",
    plannedTier: "pro",
    keywords: ["study", "revision", "outline", "ai", "notes"],
    howItWorks: [
      "Upload the document.",
      "Choose the note style you want.",
      "Download the generated notes.",
    ],
  }),
  pdfTool({
    id: "generate-key-points",
    name: "Generate Key Points",
    description: "Reduce a document to a list of its main points.",
    category: "ai",
    icon: "list-checks",
    plannedTier: "pro",
    keywords: ["bullets", "highlights", "main ideas", "ai"],
    howItWorks: [
      "Upload the document.",
      "Choose how many points you want.",
      "Copy or download the list.",
    ],
  }),
  pdfTool({
    id: "extract-dates-and-deadlines",
    name: "Extract Dates and Deadlines",
    description: "Find dates, deadlines and obligations inside a document.",
    category: "ai",
    icon: "calendar",
    plannedTier: "pro",
    keywords: ["calendar", "due date", "contract", "schedule", "ai"],
    howItWorks: [
      "Upload a contract, invoice or plan.",
      "Review the dates PDFKit found and where they appear.",
      "Export them as a list.",
    ],
  }),
  pdfTool({
    id: "translate-documents",
    name: "Translate Documents",
    description: "Translate a document while keeping its structure.",
    category: "ai",
    icon: "translate",
    plannedTier: "pro",
    keywords: ["language", "translation", "localise", "ai"],
    howItWorks: [
      "Upload the document to translate.",
      "Choose the target language.",
      "Download the translated document.",
    ],
  }),
  pdfTool({
    id: "compare-documents",
    name: "Compare Documents",
    description: "See what changed between two versions of a document.",
    category: "ai",
    icon: "ai-compare",
    plannedTier: "pro",
    keywords: ["diff", "changes", "versions", "redline", "ai"],
    howItWorks: [
      "Upload the two versions you want to compare.",
      "Review the differences side by side.",
      "Export a report of the changes.",
    ],
  }),
] as const;

/** Tool ids highlighted on the homepage, in display order. */
export const POPULAR_TOOL_IDS = [
  "merge-pdf",
  "split-pdf",
  "compress-pdf",
  "rotate-pdf",
  "delete-pdf-pages",
  "extract-pdf-pages",
  "images-to-pdf",
  "pdf-to-jpg",
] as const;
