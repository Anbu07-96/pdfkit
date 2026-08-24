// @vitest-environment node
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/documents/inspect/route";
import {
  makeNonPdf,
  makeNumberedPdf,
  makeUncompressedPdf,
} from "@/test/pdf-fixtures";

async function inspectRequest(files: File[]) {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  return POST(
    new Request("http://localhost/api/documents/inspect", {
      method: "POST",
      body: form,
    }),
  );
}

async function pdfFile(name: string, pages: number) {
  const bytes = await makeNumberedPdf(pages);
  return new File([bytes as BlobPart], name, { type: "application/pdf" });
}

describe("POST /api/documents/inspect", () => {
  it("reports the real page count", async () => {
    const response = await inspectRequest([await pdfFile("report.pdf", 24)]);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = (await response.json()) as {
      fileName: string;
      size: number;
      pageCount: number;
    };
    expect(body.pageCount).toBe(24);
    expect(body.fileName).toBe("report.pdf");
    expect(body.size).toBeGreaterThan(0);
  });

  it("rejects a request with no file", async () => {
    const response = await inspectRequest([]);
    expect(response.status).toBe(400);
  });

  it("rejects more than one file", async () => {
    const response = await inspectRequest([
      await pdfFile("a.pdf", 1),
      await pdfFile("b.pdf", 1),
    ]);
    expect(response.status).toBe(413);
  });

  it("rejects content that is not a PDF", async () => {
    const fake = new File([makeNonPdf() as BlobPart], "invoice.pdf", {
      type: "application/pdf",
    });
    const response = await inspectRequest([fake]);

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_PDF");
  });

  it("rejects a malformed PDF instead of guessing a page count", async () => {
    const broken = new File(
      [new TextEncoder().encode("%PDF-1.7 nope") as BlobPart],
      "broken.pdf",
      { type: "application/pdf" },
    );
    const response = await inspectRequest([broken]);

    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "INVALID_PDF",
    );
  });

  it("enforces the upload size limit", async () => {
    vi.stubEnv("PDFKIT_MAX_UPLOAD_SIZE", "50");
    const response = await inspectRequest([await pdfFile("a.pdf", 2)]);
    expect(response.status).toBe(413);
    vi.unstubAllEnvs();
  });
});

describe("GET /api/documents/inspect", () => {
  it("is not allowed", () => {
    expect(GET().status).toBe(405);
  });
});

describe("POST /api/documents/inspect — metadata (Phase 11)", () => {
  it("reports stored metadata with nulls for absent fields", async () => {
    const document = await PDFDocument.create();
    document.addPage([200, 200]);
    document.setTitle("Quarterly Report");
    document.setKeywords(["finance, 2026"]);
    const bytes = await document.save();
    const form = new FormData();
    form.append(
      "files",
      new File([bytes as BlobPart], "doc.pdf", { type: "application/pdf" }),
    );

    const response = await POST(
      new Request("http://localhost/api/documents/inspect", {
        method: "POST",
        body: form,
      }),
    );
    const body = (await response.json()) as {
      pageCount: number;
      metadata: {
        title: string | null;
        author: string | null;
        keywords: string[] | null;
        producer: string | null;
        creationDate: string | null;
      };
    };

    expect(response.status).toBe(200);
    expect(body.pageCount).toBe(1);
    expect(body.metadata.title).toBe("Quarterly Report");
    expect(body.metadata.author).toBeNull();
    expect(body.metadata.keywords).toEqual(["finance", "2026"]);
    expect(body.metadata.producer).not.toBeNull();
    expect(body.metadata.creationDate).not.toBeNull();
  });

  it("reports every metadata field as null for a bare document", async () => {
    const bytes = makeUncompressedPdf(2);
    const form = new FormData();
    form.append(
      "files",
      new File([bytes as BlobPart], "bare.pdf", { type: "application/pdf" }),
    );

    const response = await POST(
      new Request("http://localhost/api/documents/inspect", {
        method: "POST",
        body: form,
      }),
    );
    const body = (await response.json()) as { metadata: Record<string, unknown> };

    expect(response.status).toBe(200);
    // The eight Info-backed fields are honestly null; XMP presence is a
    // boolean, added in Phase 12.
    for (const key of [
      "title",
      "author",
      "subject",
      "keywords",
      "creator",
      "producer",
      "creationDate",
      "modificationDate",
    ]) {
      expect(body.metadata[key]).toBeNull();
    }
    expect(body.metadata.xmpPresent).toBe(false);
  });
});
