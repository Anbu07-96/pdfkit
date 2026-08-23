// @vitest-environment node
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi, afterEach } from "vitest";
import { GET, POST } from "@/app/api/tools/png-to-pdf/route";
import { makeJpeg, makeNonImage, makePng } from "@/test/pdf-fixtures";

async function call(files: File[]) {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  return POST(
    new Request("http://localhost/api/tools/png-to-pdf", {
      method: "POST",
      body: form,
    }),
  );
}

async function pngFile(name: string, bytes: Uint8Array) {
  return new File([bytes as BlobPart], name, { type: "image/png" });
}

async function errorBody(response: Response) {
  return (await response.json()) as {
    error: { code: string; message: string; details?: string[] };
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/tools/png-to-pdf", () => {
  it("converts PNGs in order with the standard headers", async () => {
    const response = await call([
      await pngFile("a.png", await makePng(400, 200, 1)),
      await pngFile("b.png", await makePng(200, 400, 2)),
    ]);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="png-to-pdf.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-pdfkit-pages")).toBe("2");
    expect(response.headers.get("x-pdfkit-output-pages")).toBe("2");
    expect(response.headers.get("x-pdfkit-artifacts")).toBe("1");

    const document = await PDFDocument.load(
      new Uint8Array(await response.arrayBuffer()),
    );
    expect(document.getPageCount()).toBe(2);
    // 96 DPI sizing, aspect exact: 400×200 → 300×150 first.
    const sizes = document.getPages().map((page) => page.getSize());
    expect(sizes[0].width).toBe(300);
    expect(sizes[0].height).toBe(150);
    expect(sizes[1].width).toBe(150);
    expect(sizes[1].height).toBe(300);
  });

  it("rejects a JPEG renamed to .png", async () => {
    const response = await call([await pngFile("sneaky.png", await makeJpeg(50, 50))]);
    expect(response.status).toBe(422);
    expect((await errorBody(response)).error.code).toBe("INVALID_IMAGE");
  });

  it("rejects a disguised non-image", async () => {
    const response = await call([await pngFile("fake.png", makeNonImage())]);
    expect(response.status).toBe(422);
    expect((await errorBody(response)).error.code).toBe("INVALID_IMAGE");
  });

  it("rejects a wrong extension", async () => {
    const response = await call([
      new File([(await makePng(20, 20)) as BlobPart], "photo.jpg", {
        type: "image/png",
      }),
    ]);
    expect(response.status).toBe(415);
    expect((await errorBody(response)).error.code).toBe("UNSUPPORTED_FILE");
  });

  it("rejects zero files", async () => {
    const response = await call([]);
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects too many files", async () => {
    vi.stubEnv("PDFKIT_MAX_FILES_PER_JOB", "2");
    const files = [
      await pngFile("a.png", await makePng(10, 10, 1)),
      await pngFile("b.png", await makePng(10, 10, 2)),
      await pngFile("c.png", await makePng(10, 10, 3)),
    ];
    const response = await call(files);
    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe("TOO_MANY_FILES");
  });

  it("rejects an oversized file", async () => {
    vi.stubEnv("PDFKIT_MAX_UPLOAD_SIZE", "100");
    const response = await call([await pngFile("big.png", await makePng(20, 20))]);
    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe("FILE_TOO_LARGE");
  });

  it("never leaks internals in errors", async () => {
    const response = await call([await pngFile("fake.png", makeNonImage())]);
    const text = JSON.stringify(await errorBody(response));
    expect(text).not.toMatch(/stack|at Object|node_modules|pdf-lib|\/home\//i);
  });

  it("rejects GET", () => {
    expect(GET().status).toBe(405);
  });
});
