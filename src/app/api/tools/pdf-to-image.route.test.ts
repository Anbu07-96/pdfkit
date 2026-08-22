// @vitest-environment node
import { PDFDocument } from "pdf-lib";
import { unzipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as jpgGET, POST as jpgPOST } from "@/app/api/tools/pdf-to-jpg/route";
import { GET as pngGET, POST as pngPOST } from "@/app/api/tools/pdf-to-png/route";
import { makeBrokenPdf, makeNonPdf, makeNumberedPdf } from "@/test/pdf-fixtures";
import { decodePng } from "@/test/png-decode";

type Handler = (request: Request) => Promise<Response>;

async function pdfFile(name: string, pages: number): Promise<File> {
  const bytes = await makeNumberedPdf(pages);
  return new File([bytes as BlobPart], name, { type: "application/pdf" });
}

async function call(handler: Handler, files: File[]) {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  return handler(
    new Request("http://localhost/api/tools/x", { method: "POST", body: form }),
  );
}

async function errorBody(response: Response) {
  return (await response.json()) as {
    error: { code: string; message: string; details?: string[] };
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each([
  { name: "pdf-to-jpg", POST: jpgPOST, GET: jpgGET, ext: "jpg", type: "image/jpeg", magic: [0xff, 0xd8] },
  { name: "pdf-to-png", POST: pngPOST, GET: pngGET, ext: "png", type: "image/png", magic: [0x89, 0x50] },
])("POST /api/tools/$name", ({ POST, GET, ext, type, magic }) => {
  it("returns one image directly for a one-page PDF", async () => {
    const response = await call(POST, [await pdfFile("document.pdf", 1)]);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(type);
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="document-page-1.${ext}"`,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-pdfkit-pages")).toBe("1");
    expect(response.headers.get("x-pdfkit-output-pages")).toBe("1");
    expect(response.headers.get("x-pdfkit-artifacts")).toBe("1");

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 2)]).toEqual(magic);
    if (ext === "png") {
      const decoded = decodePng(bytes);
      expect(decoded.width).toBeGreaterThan(0);
    }
  });

  it("returns a ZIP with one image per page for a multi-page PDF", async () => {
    const response = await call(POST, [await pdfFile("doc.pdf", 5)]);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="doc-${ext}.zip"`,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-pdfkit-pages")).toBe("5");
    expect(response.headers.get("x-pdfkit-output-pages")).toBe("5");
    expect(response.headers.get("x-pdfkit-artifacts")).toBe("5");

    const archive = new Uint8Array(await response.arrayBuffer());
    const entries = unzipSync(archive);
    const names = Object.keys(entries).sort();
    expect(names).toEqual(
      [1, 2, 3, 4, 5].map((page) => `doc-page-${page}.${ext}`).sort(),
    );
    for (const bytes of Object.values(entries)) {
      expect([...bytes.slice(0, 2)]).toEqual(magic);
      if (ext === "png") expect(decodePng(bytes).width).toBeGreaterThan(0);
    }
  });

  it("preserves page order in the artifact names", async () => {
    const response = await call(POST, [await pdfFile("ordered.pdf", 3)]);
    const archive = new Uint8Array(await response.arrayBuffer());
    const names = Object.keys(unzipSync(archive)).sort();
    expect(names).toEqual([1, 2, 3].map((page) => `ordered-page-${page}.${ext}`).sort());
  });

  it("rejects a malformed PDF", async () => {
    const broken = new File([makeBrokenPdf() as BlobPart], "broken.pdf", {
      type: "application/pdf",
    });
    const response = await call(POST, [broken]);
    expect(response.status).toBe(422);
    expect((await errorBody(response)).error.code).toBe("INVALID_PDF");
  });

  it("rejects a disguised non-PDF", async () => {
    const fake = new File([makeNonPdf() as BlobPart], "doc.pdf", {
      type: "application/pdf",
    });
    const response = await call(POST, [fake]);
    expect(response.status).toBe(422);
    expect((await errorBody(response)).error.code).toBe("INVALID_PDF");
  });

  it("rejects two uploaded PDFs", async () => {
    const response = await call(POST, [
      await pdfFile("a.pdf", 1),
      await pdfFile("b.pdf", 1),
    ]);
    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe("TOO_MANY_FILES");
  });

  it("rejects a PDF above the conversion page limit", async () => {
    vi.stubEnv("PDFKIT_CONVERSION_MAX_PAGES", "2");
    const response = await call(POST, [await pdfFile("long.pdf", 3)]);
    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe("TOO_MANY_OUTPUTS");
  });

  it("rejects an oversized PDF", async () => {
    vi.stubEnv("PDFKIT_MAX_UPLOAD_SIZE", "100");
    const response = await call(POST, [await pdfFile("big.pdf", 3)]);
    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe("FILE_TOO_LARGE");
  });

  it("sanitises hostile filenames in the disposition header", async () => {
    const bytes = await makeNumberedPdf(1);
    const hostile = new File(
      [bytes as BlobPart],
      '..\\..\\report final.pdf',
      { type: "application/pdf" },
    );
    const response = await call(POST, [hostile]);
    expect(response.status).toBe(200);
    const disposition = response.headers.get("content-disposition") ?? "";
    expect(disposition).toContain(`page-1.${ext}"`);
    expect(disposition).not.toMatch(/\.\.|\\\\|\/home\//);
  });

  it("never leaks internals in errors", async () => {
    const broken = new File([makeBrokenPdf() as BlobPart], "b.pdf", {
      type: "application/pdf",
    });
    const response = await call(POST, [broken]);
    const text = JSON.stringify(await errorBody(response));
    expect(text).not.toMatch(/stack|at Object|node_modules|pdfium|\/home\//i);
  });

  it("rejects GET", () => {
    expect(GET().status).toBe(405);
  });

  it("outputs reopen/decode successfully end to end", async () => {
    const response = await call(POST, [await pdfFile("verify.pdf", 2)]);
    const archive = new Uint8Array(await response.arrayBuffer());
    const entries = Object.entries(unzipSync(archive));
    expect(entries).toHaveLength(2);
    for (const [, bytes] of entries) {
      expect([...bytes.slice(0, 2)]).toEqual(magic);
      if (ext === "png") {
        const decoded = decodePng(bytes);
        expect(decoded.pixels.length).toBe(decoded.width * decoded.height * 4);
      } else {
        const jpeg = (await import("jpeg-js")).default;
        const decoded = jpeg.decode(bytes, { useTArray: true });
        expect(decoded.width).toBeGreaterThan(0);
      }
    }
  });
});

// Keep pdf-lib referenced for symmetric imports with the other route suites.
void PDFDocument;
