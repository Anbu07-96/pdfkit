// @vitest-environment node
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as extractGET, POST as extractPOST } from "@/app/api/tools/extract-pdf-pages/route";
import { GET as deleteGET, POST as deletePOST } from "@/app/api/tools/delete-pdf-pages/route";
import { makeNonPdf, makeNumberedPdf, pageWidths } from "@/test/pdf-fixtures";

type Handler = (request: Request) => Promise<Response>;

async function pdfFile(name: string, pages: number): Promise<File> {
  const bytes = await makeNumberedPdf(pages);
  return new File([bytes as BlobPart], name, { type: "application/pdf" });
}

async function call(
  handler: Handler,
  options: { files?: File[]; ranges?: string; url?: string },
) {
  const form = new FormData();
  for (const file of options.files ?? []) form.append("files", file, file.name);
  if (options.ranges !== undefined) form.append("ranges", options.ranges);

  return handler(
    new Request(options.url ?? "http://localhost/api/tools/x", {
      method: "POST",
      body: form,
    }),
  );
}

async function errorBody(response: Response) {
  return (await response.json()) as {
    error: { code: string; message: string; details?: string[] };
  };
}

/** Parse the returned PDF and report which source pages it holds, in order. */
async function sourcePagesOf(response: Response): Promise<number[]> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  const document = await PDFDocument.load(bytes);
  return pageWidths(document).map((width) => width - 100);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/tools/extract-pdf-pages", () => {
  it("returns a real PDF containing exactly the requested pages", async () => {
    const response = await call(extractPOST, {
      files: [await pdfFile("document.pdf", 10)],
      ranges: "1-2, 5, 8-10",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="document-extracted.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-pdfkit-pages")).toBe("10");
    expect(response.headers.get("x-pdfkit-output-pages")).toBe("6");
    expect(response.headers.get("x-pdfkit-artifacts")).toBe("1");

    expect(await sourcePagesOf(response)).toEqual([1, 2, 5, 8, 9, 10]);
  });

  it("preserves a reversed selection order", async () => {
    const response = await call(extractPOST, {
      files: [await pdfFile("doc.pdf", 10)],
      ranges: "8-10, 1-2",
    });
    expect(await sourcePagesOf(response)).toEqual([8, 9, 10, 1, 2]);
  });

  it("extracts a single page", async () => {
    const response = await call(extractPOST, {
      files: [await pdfFile("doc.pdf", 5)],
      ranges: "3",
    });
    expect(await sourcePagesOf(response)).toEqual([3]);
  });

  it("rejects a missing file", async () => {
    const response = await call(extractPOST, { ranges: "1" });
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects more than one file", async () => {
    const response = await call(extractPOST, {
      files: [await pdfFile("a.pdf", 2), await pdfFile("b.pdf", 2)],
      ranges: "1",
    });
    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe("TOO_MANY_FILES");
  });

  it("rejects a missing selection", async () => {
    const response = await call(extractPOST, { files: [await pdfFile("a.pdf", 3)] });
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("INVALID_PAGE_RANGE");
  });

  it("rejects invalid ranges", async () => {
    const response = await call(extractPOST, {
      files: [await pdfFile("a.pdf", 3)],
      ranges: "abc",
    });
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("INVALID_PAGE_RANGE");
  });

  it("rejects out-of-range pages", async () => {
    const response = await call(extractPOST, {
      files: [await pdfFile("a.pdf", 3)],
      ranges: "9",
    });
    expect(response.status).toBe(400);
    const body = await errorBody(response);
    expect(body.error.code).toBe("PAGE_OUT_OF_RANGE");
    expect(body.error.message).toContain("3 pages");
  });

  it("rejects overlapping ranges", async () => {
    const response = await call(extractPOST, {
      files: [await pdfFile("a.pdf", 10)],
      ranges: "1-5, 4-8",
    });
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("OVERLAPPING_RANGES");
  });

  it("rejects a disguised non-PDF", async () => {
    const fake = new File([makeNonPdf() as BlobPart], "invoice.pdf", {
      type: "application/pdf",
    });
    const response = await call(extractPOST, { files: [fake], ranges: "1" });
    expect(response.status).toBe(422);
    expect((await errorBody(response)).error.code).toBe("INVALID_PDF");
  });

  it("rejects an unsupported file type", async () => {
    const image = new File(["nope"], "photo.png", { type: "image/png" });
    const response = await call(extractPOST, { files: [image], ranges: "1" });
    expect(response.status).toBe(415);
    expect((await errorBody(response)).error.code).toBe("UNSUPPORTED_FILE");
  });

  it("rejects an empty file", async () => {
    const empty = new File([], "empty.pdf", { type: "application/pdf" });
    const response = await call(extractPOST, { files: [empty], ranges: "1" });
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a malformed PDF", async () => {
    const broken = new File(
      [new TextEncoder().encode("%PDF-1.7 truncated") as BlobPart],
      "broken.pdf",
      { type: "application/pdf" },
    );
    const response = await call(extractPOST, { files: [broken], ranges: "1" });
    expect(response.status).toBe(422);
    expect((await errorBody(response)).error.code).toBe("INVALID_PDF");
  });

  it("rejects an oversized file", async () => {
    vi.stubEnv("PDFKIT_MAX_UPLOAD_SIZE", "100");
    const response = await call(extractPOST, {
      files: [await pdfFile("a.pdf", 3)],
      ranges: "1",
    });
    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe("FILE_TOO_LARGE");
  });

  it("rejects a non-multipart request", async () => {
    const response = await extractPOST(
      new Request("http://localhost/api/tools/extract-pdf-pages", {
        method: "POST",
        body: JSON.stringify({ ranges: "1" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(response.status).toBe(400);
  });

  it("never leaks internals", async () => {
    const response = await call(extractPOST, {
      files: [await pdfFile("a.pdf", 3)],
      ranges: "99",
    });
    const text = JSON.stringify(await errorBody(response));
    expect(text).not.toMatch(/stack|at Object|node_modules|pdf-lib|\/home\//i);
  });

  it("rejects GET", () => {
    const response = extractGET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});

describe("POST /api/tools/delete-pdf-pages", () => {
  it("returns a real PDF without the removed pages", async () => {
    const response = await call(deletePOST, {
      files: [await pdfFile("document.pdf", 10)],
      ranges: "2, 4, 7",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="document-pages-removed.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-pdfkit-output-pages")).toBe("7");

    expect(await sourcePagesOf(response)).toEqual([1, 3, 5, 6, 8, 9, 10]);
  });

  it("removes a middle range", async () => {
    const response = await call(deletePOST, {
      files: [await pdfFile("doc.pdf", 10)],
      ranges: "3-7",
    });
    expect(await sourcePagesOf(response)).toEqual([1, 2, 8, 9, 10]);
  });

  it("can leave a single page", async () => {
    const response = await call(deletePOST, {
      files: [await pdfFile("doc.pdf", 5)],
      ranges: "1-4",
    });
    expect(await sourcePagesOf(response)).toEqual([5]);
  });

  it("refuses to delete every page", async () => {
    const response = await call(deletePOST, {
      files: [await pdfFile("doc.pdf", 5)],
      ranges: "1-5",
    });

    expect(response.status).toBe(400);
    const body = await errorBody(response);
    expect(body.error.code).toBe("NO_PAGES_REMAIN");
    expect(body.error.message).toMatch(/at least one page/i);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("rejects a missing file", async () => {
    const response = await call(deletePOST, { ranges: "1" });
    expect(response.status).toBe(400);
  });

  it("rejects more than one file", async () => {
    const response = await call(deletePOST, {
      files: [await pdfFile("a.pdf", 2), await pdfFile("b.pdf", 2)],
      ranges: "1",
    });
    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe("TOO_MANY_FILES");
  });

  it("rejects a missing selection", async () => {
    const response = await call(deletePOST, { files: [await pdfFile("a.pdf", 3)] });
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("INVALID_PAGE_RANGE");
  });

  it("rejects invalid, out-of-range and overlapping selections", async () => {
    const file = () => pdfFile("a.pdf", 5);

    const invalid = await call(deletePOST, { files: [await file()], ranges: "abc" });
    expect((await errorBody(invalid)).error.code).toBe("INVALID_PAGE_RANGE");

    const outOfRange = await call(deletePOST, { files: [await file()], ranges: "8" });
    expect((await errorBody(outOfRange)).error.code).toBe("PAGE_OUT_OF_RANGE");

    const overlap = await call(deletePOST, {
      files: [await file()],
      ranges: "1-3, 2-4",
    });
    expect((await errorBody(overlap)).error.code).toBe("OVERLAPPING_RANGES");
  });

  it("rejects a disguised non-PDF", async () => {
    const fake = new File([makeNonPdf() as BlobPart], "invoice.pdf", {
      type: "application/pdf",
    });
    const response = await call(deletePOST, { files: [fake], ranges: "1" });
    expect(response.status).toBe(422);
    expect((await errorBody(response)).error.code).toBe("INVALID_PDF");
  });

  it("rejects a malformed PDF", async () => {
    const broken = new File(
      [new TextEncoder().encode("%PDF-1.7 truncated") as BlobPart],
      "broken.pdf",
      { type: "application/pdf" },
    );
    const response = await call(deletePOST, { files: [broken], ranges: "1" });
    expect(response.status).toBe(422);
  });

  it("rejects an oversized file", async () => {
    vi.stubEnv("PDFKIT_MAX_UPLOAD_SIZE", "100");
    const response = await call(deletePOST, {
      files: [await pdfFile("a.pdf", 3)],
      ranges: "1",
    });
    expect(response.status).toBe(413);
  });

  it("never leaks internals", async () => {
    const response = await call(deletePOST, {
      files: [await pdfFile("a.pdf", 3)],
      ranges: "1-3",
    });
    const text = JSON.stringify(await errorBody(response));
    expect(text).not.toMatch(/stack|at Object|node_modules|pdf-lib|\/home\//i);
  });

  it("rejects GET", () => {
    expect(deleteGET().status).toBe(405);
  });
});
