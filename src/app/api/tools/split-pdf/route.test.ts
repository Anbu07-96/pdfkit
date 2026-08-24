// @vitest-environment node
import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/tools/split-pdf/route";
import { expectedWidths, makeNonPdf, makeNumberedPdf, pageWidths } from "@/test/pdf-fixtures";

async function pdfFile(name: string, pages: number): Promise<File> {
  const bytes = await makeNumberedPdf(pages);
  return new File([bytes as BlobPart], name, { type: "application/pdf" });
}

function request(form: FormData) {
  return new Request("http://localhost/api/tools/split-pdf", {
    method: "POST",
    body: form,
  });
}

async function splitRequest(options: {
  files?: File[];
  mode?: string;
  ranges?: string;
}) {
  const form = new FormData();
  for (const file of options.files ?? []) form.append("files", file, file.name);
  if (options.mode !== undefined) form.append("mode", options.mode);
  if (options.ranges !== undefined) form.append("ranges", options.ranges);
  return POST(request(form));
}

async function errorBody(response: Response) {
  return (await response.json()) as {
    error: { code: string; message: string; details?: string[] };
  };
}

/** Extract the ZIP and parse every PDF it contains. */
async function readArchive(response: Response) {
  const archive = new Uint8Array(await response.arrayBuffer());
  const entries = unzipSync(archive);
  const names = Object.keys(entries);

  const documents = await Promise.all(
    names.map(async (name) => {
      const document = await PDFDocument.load(entries[name]);
      return {
        name,
        pageCount: document.getPageCount(),
        widths: pageWidths(document),
        header: new TextDecoder().decode(entries[name].slice(0, 5)),
      };
    }),
  );

  return { names, documents };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/tools/split-pdf — every page", () => {
  it("returns a ZIP holding one real PDF per page", async () => {
    const response = await splitRequest({
      files: [await pdfFile("document.pdf", 5)],
      mode: "every-page",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="document-split.zip"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-pdfkit-artifacts")).toBe("5");
    expect(response.headers.get("x-pdfkit-pages")).toBe("5");

    const { names, documents } = await readArchive(response);
    expect(names.sort()).toEqual([
      "document-1.pdf",
      "document-2.pdf",
      "document-3.pdf",
      "document-4.pdf",
      "document-5.pdf",
    ]);

    for (const document of documents) {
      expect(document.header).toBe("%PDF-");
      expect(document.pageCount).toBe(1);
    }

    // document-3.pdf must really contain source page 3.
    const third = documents.find((document) => document.name === "document-3.pdf")!;
    expect(third.widths).toEqual(expectedWidths([3]));
  });
});

describe("POST /api/tools/split-pdf — ranges", () => {
  it("returns one PDF per range, in order, with the right pages", async () => {
    const response = await splitRequest({
      files: [await pdfFile("report.pdf", 10)],
      mode: "ranges",
      ranges: "1-3, 4-7, 8-10",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-pdfkit-artifacts")).toBe("3");

    const { names, documents } = await readArchive(response);
    expect(names.sort()).toEqual([
      "report-part-1.pdf",
      "report-part-2.pdf",
      "report-part-3.pdf",
    ]);

    const byName = Object.fromEntries(documents.map((doc) => [doc.name, doc]));
    expect(byName["report-part-1.pdf"].pageCount).toBe(3);
    expect(byName["report-part-2.pdf"].pageCount).toBe(4);
    expect(byName["report-part-3.pdf"].pageCount).toBe(3);
    expect(byName["report-part-2.pdf"].widths).toEqual(expectedWidths([4, 5, 6, 7]));
  });

  it("streams a single PDF (not a ZIP) when one range is requested", async () => {
    const response = await splitRequest({
      files: [await pdfFile("report.pdf", 10)],
      mode: "ranges",
      ranges: "2-4",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="report-part-1.pdf"',
    );
    expect(response.headers.get("x-pdfkit-artifacts")).toBe("1");

    const bytes = new Uint8Array(await response.arrayBuffer());
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBe(3);
    expect(pageWidths(document)).toEqual(expectedWidths([2, 3, 4]));
  });
});

describe("POST /api/tools/split-pdf — validation", () => {
  it("rejects a missing file", async () => {
    const response = await splitRequest({ mode: "every-page" });
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects more than one file", async () => {
    const response = await splitRequest({
      files: [await pdfFile("a.pdf", 2), await pdfFile("b.pdf", 2)],
      mode: "every-page",
    });

    expect(response.status).toBe(413);
    const body = await errorBody(response);
    expect(body.error.code).toBe("TOO_MANY_FILES");
    expect(body.error.message).toMatch(/one file at a time/i);
  });

  it("rejects a missing mode", async () => {
    const response = await splitRequest({ files: [await pdfFile("a.pdf", 2)] });
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("INVALID_SPLIT_CONFIGURATION");
  });

  it("rejects an unknown mode", async () => {
    const response = await splitRequest({
      files: [await pdfFile("a.pdf", 2)],
      mode: "sideways",
    });
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("INVALID_SPLIT_CONFIGURATION");
  });

  it("rejects invalid range syntax", async () => {
    const response = await splitRequest({
      files: [await pdfFile("a.pdf", 5)],
      mode: "ranges",
      ranges: "abc",
    });
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("INVALID_PAGE_RANGE");
  });

  it("rejects pages outside the document", async () => {
    const response = await splitRequest({
      files: [await pdfFile("a.pdf", 5)],
      mode: "ranges",
      ranges: "1-99",
    });
    expect(response.status).toBe(400);
    const body = await errorBody(response);
    expect(body.error.code).toBe("PAGE_OUT_OF_RANGE");
    expect(body.error.message).toContain("5 pages");
  });

  it("rejects overlapping ranges", async () => {
    const response = await splitRequest({
      files: [await pdfFile("a.pdf", 10)],
      mode: "ranges",
      ranges: "1-5, 4-8",
    });
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("OVERLAPPING_RANGES");
  });

  it("rejects too many outputs before producing any", async () => {
    vi.stubEnv("PDFKIT_MAX_SPLIT_OUTPUTS", "3");

    const response = await splitRequest({
      files: [await pdfFile("a.pdf", 10)],
      mode: "every-page",
    });

    expect(response.status).toBe(413);
    const body = await errorBody(response);
    expect(body.error.code).toBe("TOO_MANY_OUTPUTS");
    expect(body.error.message).toContain("10");
  });

  it("rejects a file that is not a PDF, whatever it is called", async () => {
    const fake = new File([makeNonPdf() as BlobPart], "invoice.pdf", {
      type: "application/pdf",
    });
    const response = await POST(
      request(
        (() => {
          const form = new FormData();
          form.append("files", fake, fake.name);
          form.append("mode", "every-page");
          return form;
        })(),
      ),
    );

    expect(response.status).toBe(422);
    expect((await errorBody(response)).error.code).toBe("INVALID_PDF");
  });

  it("rejects an unsupported file type", async () => {
    const image = new File(["not-a-pdf"], "photo.png", { type: "image/png" });
    const form = new FormData();
    form.append("files", image, image.name);
    form.append("mode", "every-page");

    const response = await POST(request(form));
    expect(response.status).toBe(415);
    expect((await errorBody(response)).error.code).toBe("UNSUPPORTED_FILE");
  });

  it("rejects a malformed PDF", async () => {
    const broken = new File(
      [new TextEncoder().encode("%PDF-1.7 truncated nonsense") as BlobPart],
      "broken.pdf",
      { type: "application/pdf" },
    );
    const form = new FormData();
    form.append("files", broken, broken.name);
    form.append("mode", "every-page");

    const response = await POST(request(form));
    expect(response.status).toBe(422);
    expect((await errorBody(response)).error.code).toBe("INVALID_PDF");
  });

  it("rejects a file above the per-file limit", async () => {
    vi.stubEnv("PDFKIT_MAX_UPLOAD_SIZE", "100");

    const response = await splitRequest({
      files: [await pdfFile("a.pdf", 3)],
      mode: "every-page",
    });

    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe("FILE_TOO_LARGE");
  });

  it("rejects a non-multipart request", async () => {
    const response = await POST(
      new Request("http://localhost/api/tools/split-pdf", {
        method: "POST",
        body: JSON.stringify({ mode: "every-page" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an oversized request from the content-length header alone", async () => {
    vi.stubEnv("PDFKIT_MAX_UPLOAD_SIZE", "1000");
    vi.stubEnv("PDFKIT_MAX_TOTAL_UPLOAD_SIZE", "1000");

    const form = new FormData();
    form.append("files", await pdfFile("a.pdf", 1), "a.pdf");
    form.append("mode", "every-page");
    const readBody = vi.fn(async () => form);

    const response = await POST({
      headers: new Headers({
        "content-type": "multipart/form-data; boundary=----pdfkit",
        "content-length": "9000000",
      }),
      formData: readBody,
    } as unknown as Request);

    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe("TOTAL_SIZE_EXCEEDED");
    expect(readBody).not.toHaveBeenCalled();
  });

  it("never leaks internals in an error response", async () => {
    const response = await splitRequest({
      files: [await pdfFile("a.pdf", 3)],
      mode: "ranges",
      ranges: "9-9",
    });

    const text = JSON.stringify(await errorBody(response));
    expect(text).not.toMatch(/stack|at Object|node_modules|pdf-lib|\/home\//i);
  });
});

describe("GET /api/tools/split-pdf", () => {
  it("is not allowed", () => {
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});
