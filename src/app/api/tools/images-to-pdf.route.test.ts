// @vitest-environment node
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/tools/images-to-pdf/route";
import { makeJpeg, makeNonImage, makeNumberedPdf, makePng } from "@/test/pdf-fixtures";

async function call(files: File[]) {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  return POST(
    new Request("http://localhost/api/tools/images-to-pdf", {
      method: "POST",
      body: form,
    }),
  );
}

async function imageFile(name: string, bytes: Uint8Array, type: string) {
  return new File([bytes as BlobPart], name, { type });
}

async function errorBody(response: Response) {
  return (await response.json()) as {
    error: { code: string; message: string; details?: string[] };
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/tools/images-to-pdf", () => {
  it("converts one JPEG into a one-page PDF with the standard headers", async () => {
    const response = await call([
      await imageFile("photo.jpg", await makeJpeg(320, 200), "image/jpeg"),
    ]);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="images-to-pdf.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-pdfkit-pages")).toBe("1");
    expect(response.headers.get("x-pdfkit-output-pages")).toBe("1");
    expect(response.headers.get("x-pdfkit-artifacts")).toBe("1");

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("converts mixed JPEG/PNG uploads preserving order", async () => {
    const response = await call([
      await imageFile("a.jpg", await makeJpeg(100, 50, 1), "image/jpeg"),
      await imageFile("b.png", await makePng(80, 40, 2), "image/png"),
      await imageFile("c.jpeg", await makeJpeg(60, 30, 3), "image/jpeg"),
    ]);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-pdfkit-pages")).toBe("3");

    const document = await PDFDocument.load(
      new Uint8Array(await response.arrayBuffer()),
    );
    const widths = document
      .getPages()
      .map((page) => Math.round(page.getSize().width));
    // 96 DPI sizing: 100→75, 80→60, 60→45.
    expect(widths).toEqual([75, 60, 45]);
  });

  it("rejects a disguised non-image", async () => {
    const response = await call([
      await imageFile("document.jpg", makeNonImage(), "image/jpeg"),
    ]);
    expect(response.status).toBe(422);
    expect((await errorBody(response)).error.code).toBe("INVALID_IMAGE");
  });

  it("rejects a PDF renamed to .jpg", async () => {
    const response = await call([
      await imageFile("document.jpg", await makeNumberedPdf(2), "image/jpeg"),
    ]);
    expect(response.status).toBe(422);
    expect((await errorBody(response)).error.code).toBe("INVALID_IMAGE");
  });

  it("rejects zero files", async () => {
    const response = await call([]);
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects too many files", async () => {
    vi.stubEnv("PDFKIT_MAX_FILES_PER_JOB", "2");
    const files = [
      await imageFile("a.jpg", await makeJpeg(10, 10, 1), "image/jpeg"),
      await imageFile("b.jpg", await makeJpeg(10, 10, 2), "image/jpeg"),
      await imageFile("c.jpg", await makeJpeg(10, 10, 3), "image/jpeg"),
    ];
    const response = await call(files);
    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe("TOO_MANY_FILES");
  });

  it("rejects an oversized image", async () => {
    vi.stubEnv("PDFKIT_MAX_UPLOAD_SIZE", "100");
    const response = await call([
      await imageFile("photo.jpg", await makeJpeg(20, 20), "image/jpeg"),
    ]);
    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe("FILE_TOO_LARGE");
  });

  it("never leaks internals in errors", async () => {
    const response = await call([
      await imageFile("x.jpg", makeNonImage(), "image/jpeg"),
    ]);
    const text = JSON.stringify(await errorBody(response));
    expect(text).not.toMatch(/stack|at Object|node_modules|pdf-lib|\/home\//i);
  });

  it("rejects GET", () => {
    expect(GET().status).toBe(405);
  });
});
