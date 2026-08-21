import { PDFDocument, StandardFonts } from "pdf-lib";

/** Test fixtures that build genuinely valid PDFs with pdf-lib. */

/** A small, valid PDF with one page per supplied label. */
export async function makePdf(labels: string[]): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);

  for (const label of labels) {
    const page = document.addPage([300, 300]);
    page.drawText(label, { x: 20, y: 150, size: 24, font });
  }

  return document.save();
}

/**
 * A valid PDF whose pages are individually identifiable: page N is
 * `(100 + N) x 200`, so page order can be asserted after copying.
 */
export async function makeNumberedPdf(pageCount: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);

  for (let page = 1; page <= pageCount; page += 1) {
    const created = document.addPage([100 + page, 200]);
    created.drawText(`page ${page}`, { x: 10, y: 100, size: 10, font });
  }

  return document.save();
}

/** Page widths of a document, used to assert page identity and order. */
export function pageWidths(document: PDFDocument): number[] {
  return document.getPages().map((page) => Math.round(page.getSize().width));
}

/** Widths expected for 1-based page numbers produced by `makeNumberedPdf`. */
export function expectedWidths(pages: number[]): number[] {
  return pages.map((page) => 100 + page);
}

/** Bytes that start with the PDF header but are not parseable. */
export function makeBrokenPdf(): Uint8Array {
  return new TextEncoder().encode("%PDF-1.7 but truncated nonsense");
}

/** Bytes that are not a PDF at all, whatever the file is named. */
export function makeNonPdf(): Uint8Array {
  return new TextEncoder().encode("GIF89a definitely not a pdf");
}

/** A `File` suitable for `FormData`, backed by real PDF bytes. */
export async function makePdfFile(
  name: string,
  labels: string[] = ["page"],
): Promise<File> {
  const bytes = await makePdf(labels);
  return new File([bytes as BlobPart], name, { type: "application/pdf" });
}
