// @vitest-environment node
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as thumbnailsPOST } from "@/app/api/documents/thumbnails/route";
import { GET, POST } from "@/app/api/tools/rotate-pdf/route";
import { makeNonPdf, makeNumberedPdf, pageWidths } from "@/test/pdf-fixtures";
import { decodePng } from "@/test/png-decode";

async function pdfFile(name: string, pages: number): Promise<File> {
  const bytes = await makeNumberedPdf(pages);
  return new File([bytes as BlobPart], name, { type: "application/pdf" });
}

function post(
  handler: (request: Request) => Promise<Response>,
  fields: Record<string, string | File | undefined>,
  files: File[] = [],
) {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (value instanceof File) form.append(key, value, value.name);
    else form.append(key, value);
  }
  return handler(
    new Request("http://localhost/api/tools/rotate-pdf", {
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

/** Rotations of every page of a returned PDF, in order. */
async function rotationsOf(response: Response): Promise<number[]> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  const document = await PDFDocument.load(bytes);
  return document.getPages().map((page) => page.getRotation().angle);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/tools/rotate-pdf", () => {
  it("returns a real PDF with the requested rotations applied", async () => {
    const response = await post(
      POST,
      { rotations: '{"1":90,"3":180,"5":270}' },
      [await pdfFile("document.pdf", 5)],
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="document-rotated.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-pdfkit-pages")).toBe("5");
    expect(response.headers.get("x-pdfkit-output-pages")).toBe("5");

    expect(await rotationsOf(response)).toEqual([90, 0, 180, 0, 270]);
  });

  it("keeps page count and order", async () => {
    const response = await post(POST, { rotations: '{"2":90}' }, [
      await pdfFile("doc.pdf", 4),
    ]);

    const bytes = new Uint8Array(await response.arrayBuffer());
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBe(4);
    expect(pageWidths(document).map((width) => width - 100)).toEqual([1, 2, 3, 4]);
  });

  it("accepts a request with no rotations and returns the document unchanged", async () => {
    const response = await post(POST, {}, [await pdfFile("doc.pdf", 3)]);
    expect(response.status).toBe(200);
    expect(await rotationsOf(response)).toEqual([0, 0, 0]);
  });

  it("rejects an invalid rotation angle", async () => {
    const response = await post(POST, { rotations: '{"1":45}' }, [
      await pdfFile("doc.pdf", 3),
    ]);
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("INVALID_PAGE_ROTATION");
  });

  it("rejects invalid JSON", async () => {
    const response = await post(POST, { rotations: "{oops" }, [
      await pdfFile("doc.pdf", 3),
    ]);
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("INVALID_PAGE_ROTATION");
  });

  it("rejects page 0 and pages beyond the document", async () => {
    const zero = await post(POST, { rotations: '{"0":90}' }, [
      await pdfFile("doc.pdf", 3),
    ]);
    expect(zero.status).toBe(400);
    expect((await errorBody(zero)).error.code).toBe("PAGE_OUT_OF_RANGE");

    const beyond = await post(POST, { rotations: '{"9":90}' }, [
      await pdfFile("doc.pdf", 3),
    ]);
    expect(beyond.status).toBe(400);
    expect((await errorBody(beyond)).error.code).toBe("PAGE_OUT_OF_RANGE");
  });

  it("rejects no files and two files", async () => {
    const none = await post(POST, { rotations: '{"1":90}' });
    expect(none.status).toBe(400);
    expect((await errorBody(none)).error.code).toBe("VALIDATION_ERROR");

    const two = await post(POST, { rotations: '{"1":90}' }, [
      await pdfFile("a.pdf", 2),
      await pdfFile("b.pdf", 2),
    ]);
    expect(two.status).toBe(413);
    expect((await errorBody(two)).error.code).toBe("TOO_MANY_FILES");
  });

  it("rejects unsupported and disguised files", async () => {
    const image = new File(["nope"], "photo.png", { type: "image/png" });
    const unsupported = await post(POST, { rotations: "{}" }, [image]);
    expect(unsupported.status).toBe(415);

    const fake = new File([makeNonPdf() as BlobPart], "invoice.pdf", {
      type: "application/pdf",
    });
    const disguised = await post(POST, { rotations: "{}" }, [fake]);
    expect(disguised.status).toBe(422);
    expect((await errorBody(disguised)).error.code).toBe("INVALID_PDF");

    const broken = new File(
      [new TextEncoder().encode("%PDF-1.7 truncated") as BlobPart],
      "broken.pdf",
      { type: "application/pdf" },
    );
    const malformed = await post(POST, { rotations: '{"1":90}' }, [broken]);
    expect(malformed.status).toBe(422);
  });

  it("rejects an oversized file", async () => {
    vi.stubEnv("PDFKIT_MAX_UPLOAD_SIZE", "100");
    const response = await post(POST, { rotations: "{}" }, [
      await pdfFile("doc.pdf", 3),
    ]);
    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe("FILE_TOO_LARGE");
  });

  it("rejects a non-multipart request", async () => {
    const response = await POST(
      new Request("http://localhost/api/tools/rotate-pdf", {
        method: "POST",
        body: JSON.stringify({ rotations: {} }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(response.status).toBe(400);
  });

  it("never leaks internals", async () => {
    const response = await post(POST, { rotations: '{"1":45}' }, [
      await pdfFile("doc.pdf", 3),
    ]);
    const text = JSON.stringify(await errorBody(response));
    expect(text).not.toMatch(/stack|at Object|node_modules|pdf-lib|\/home\//i);
  });

  it("rejects GET", () => {
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});

describe("POST /api/documents/thumbnails — rotation", () => {
  it("returns previews turned by the requested angle", async () => {
    const form = new FormData();
    const file = await pdfFile("doc.pdf", 2);
    form.append("files", file, file.name);
    form.append("pages", "1,2");
    form.append("rotations", '{"2":90}');

    const response = await thumbnailsPOST(
      new Request("http://localhost/api/documents/thumbnails", {
        method: "POST",
        body: form,
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      thumbnails: {
        pageNumber: number;
        rotation: number;
        width: number;
        height: number;
        dataUrl: string;
      }[];
    };

    const [first, second] = body.thumbnails;
    expect(first.rotation).toBe(0);
    expect(second.rotation).toBe(90);

    // Page 2 is 102x200 upright; turned 90° it must become landscape.
    expect(first.height).toBeGreaterThan(first.width);
    expect(second.width).toBeGreaterThan(second.height);

    const image = decodePng(
      new Uint8Array(Buffer.from(second.dataUrl.split(",")[1], "base64")),
    );
    expect(image.width).toBe(second.width);
    expect(image.height).toBe(second.height);
  });

  it("rejects an invalid rotation", async () => {
    const form = new FormData();
    const file = await pdfFile("doc.pdf", 2);
    form.append("files", file, file.name);
    form.append("rotations", '{"1":45}');

    const response = await thumbnailsPOST(
      new Request("http://localhost/api/documents/thumbnails", {
        method: "POST",
        body: form,
      }),
    );

    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("INVALID_PAGE_ROTATION");
  });
});
