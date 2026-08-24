// @vitest-environment node
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi, afterEach } from "vitest";
import { GET, POST } from "@/app/api/tools/crop/route";
import { makeBrokenPdf, makeNumberedPdf } from "@/test/pdf-fixtures";

// makeNumberedPdf pages are (100+N) x 200 pt — the rectangle must fit the
// narrowest selected page (101 pt wide).
const RECT: Record<string, string> = { mode: "rectangle", x: "5", y: "5", width: "50", height: "100" };
const MARGINS: Record<string, string> = { mode: "margins", top: "20", right: "10", bottom: "5", left: "15" };

async function call(fields: Record<string, string>, files?: File[]) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  for (const file of files ?? []) form.append("files", file, file.name);
  return POST(
    new Request("http://localhost/api/tools/crop", {
      method: "POST",
      body: form,
    }),
  );
}

async function pdfFile(name: string, pages: number): Promise<File> {
  const bytes = await makeNumberedPdf(pages);
  return new File([bytes as BlobPart], name, { type: "application/pdf" });
}

async function errorBody(response: Response) {
  return (await response.json()) as {
    error: { code: string; message: string; details?: string[] };
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/tools/crop", () => {
  it("crops every page by default with the standard headers", async () => {
    const response = await call(RECT, [await pdfFile("invoice.pdf", 3)]);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="crop.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-pdfkit-pages")).toBe("3");
    expect(response.headers.get("x-pdfkit-output-pages")).toBe("3");
    expect(response.headers.get("x-pdfkit-cropped-pages")).toBe("3");
    expect(response.headers.get("x-pdfkit-artifacts")).toBe("1");

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBe(3);
    expect(document.getPage(1).getCropBox()).toEqual({
      x: 5,
      y: 5,
      width: 50,
      height: 100,
    });
    expect(Number(response.headers.get("content-length"))).toBe(bytes.length);
  });

  it("crops only the requested ranges and reports the count", async () => {
    const response = await call(
      { ...MARGINS, ranges: "1-2" },
      [await pdfFile("doc.pdf", 5)],
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-pdfkit-cropped-pages")).toBe("2");
    expect(response.headers.get("x-pdfkit-pages")).toBe("5");

    const document = await PDFDocument.load(
      new Uint8Array(await response.arrayBuffer()),
    );
    // makeNumberedPdf page 1 is 101x200; margins 20/10/5/15.
    expect(document.getPage(0).getCropBox()).toEqual({
      x: 15,
      y: 5,
      width: 76,
      height: 175,
    });
    // Pages 3-5 untouched (no CropBox entries on the fixtures).
    expect(document.getPage(2).getCropBox()).toEqual({
      x: 0,
      y: 0,
      width: 103,
      height: 200,
    });
  });

  it("rejects invalid geometry and malformed numbers with 400", async () => {
    const patches: Record<string, string>[] = [
      { mode: "ellipse" },
      { mode: "rectangle", x: "NaN", y: "0", width: "50", height: "50" },
      { mode: "rectangle", x: "0", y: "0", width: "Infinity", height: "50" },
      { mode: "rectangle", x: "0", y: "0", width: "5", height: "50" },
      { mode: "rectangle", x: "-5", y: "0", width: "50", height: "50" },
      { mode: "rectangle", x: "0", y: "0", width: "500", height: "50" },
      { mode: "margins", top: "-1", right: "0", bottom: "0", left: "0" },
      { mode: "margins", top: "abc", right: "0", bottom: "0", left: "0" },
];
    for (const patch of patches) {
      const response = await call({ ...RECT, ...patch }, [await pdfFile("a.pdf", 1)]);
      expect(response.status, JSON.stringify(patch)).toBe(400);
      expect((await errorBody(response)).error.code).toBe(
        "INVALID_CROP_CONFIGURATION",
      );
    }
  });

  it("rejects invalid ranges with the shared error model", async () => {
    const invalid = await call({ ...RECT, ranges: "abc" }, [await pdfFile("a.pdf", 2)]);
    expect(invalid.status).toBe(400);
    expect((await errorBody(invalid)).error.code).toBe("INVALID_PAGE_RANGE");

    const overflow = await call({ ...RECT, ranges: "1-9" }, [await pdfFile("a.pdf", 2)]);
    expect(overflow.status).toBe(400);
    expect((await errorBody(overflow)).error.code).toBe("PAGE_OUT_OF_RANGE");
  });

  it("rejects zero and multiple files", async () => {
    const none = await call(RECT, []);
    expect(none.status).toBe(400);
    expect((await errorBody(none)).error.code).toBe("VALIDATION_ERROR");

    const two = await call(RECT, [await pdfFile("a.pdf", 1), await pdfFile("b.pdf", 1)]);
    expect(two.status).toBe(413);
    expect((await errorBody(two)).error.code).toBe("TOO_MANY_FILES");
  });

  it("rejects malformed and disguised PDFs", async () => {
    const broken = new File([makeBrokenPdf() as BlobPart], "broken.pdf", {
      type: "application/pdf",
    });
    const malformed = await call(RECT, [broken]);
    expect(malformed.status).toBe(422);
    expect((await errorBody(malformed)).error.code).toBe("INVALID_PDF");

    const fake = new File(
      [new TextEncoder().encode("GIF89a no") as BlobPart],
      "doc.pdf",
      { type: "application/pdf" },
    );
    const disguised = await call(RECT, [fake]);
    expect(disguised.status).toBe(422);
    expect((await errorBody(disguised)).error.code).toBe("INVALID_PDF");
  });

  it("never carries hostile source filenames into the response", async () => {
    const bytes = await makeNumberedPdf(1);
    const hostile = new File([bytes as BlobPart], "../..\\payroll Ő.pdf", {
      type: "application/pdf",
    });
    const response = await call(RECT, [hostile]);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="crop.pdf"',
    );
  });

  it("never leaks internals in errors", async () => {
    const broken = new File([makeBrokenPdf() as BlobPart], "b.pdf", {
      type: "application/pdf",
    });
    const response = await call(RECT, [broken]);
    const text = JSON.stringify(await errorBody(response));
    expect(text).not.toMatch(/stack|at Object|node_modules|pdf-lib|\/home\//i);
  });

  it("rejects GET", () => {
    expect(GET().status).toBe(405);
  });
});
