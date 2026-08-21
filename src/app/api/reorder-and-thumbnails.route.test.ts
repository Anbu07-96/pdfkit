// @vitest-environment node
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GET as thumbnailsGET,
  POST as thumbnailsPOST,
} from "@/app/api/documents/thumbnails/route";
import {
  GET as reorderGET,
  POST as reorderPOST,
} from "@/app/api/tools/reorder-pdf-pages/route";
import {
  makeColouredPdf,
  makeNonPdf,
  makeNumberedPdf,
  PAGE_COLOURS,
  pageWidths,
} from "@/test/pdf-fixtures";
import { centerPixel, decodePng } from "@/test/png-decode";

async function pdfFile(name: string, pages: number): Promise<File> {
  const bytes = await makeNumberedPdf(pages);
  return new File([bytes as BlobPart], name, { type: "application/pdf" });
}

function post(
  handler: (request: Request) => Promise<Response>,
  fields: Record<string, string | File | undefined>,
  url = "http://localhost/api/x",
) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (value instanceof File) form.append(key, value, value.name);
    else form.append(key, value);
  }
  return handler(new Request(url, { method: "POST", body: form }));
}

async function errorBody(response: Response) {
  return (await response.json()) as {
    error: { code: string; message: string; details?: string[] };
  };
}

/** Source pages of a returned PDF, in order (fixture geometry). */
async function sourcePagesOf(response: Response): Promise<number[]> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  const document = await PDFDocument.load(bytes);
  return pageWidths(document).map((width) => width - 100);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

/* -------------------------------------------------------------------------- */
/* Reorder API                                                                */
/* -------------------------------------------------------------------------- */
describe("POST /api/tools/reorder-pdf-pages", () => {
  it("returns a real PDF with the pages in the requested order", async () => {
    const response = await post(reorderPOST, {
      files: await pdfFile("document.pdf", 5),
      order: "5,2,4,1,3",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="document-reordered.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-pdfkit-pages")).toBe("5");
    expect(response.headers.get("x-pdfkit-output-pages")).toBe("5");

    expect(await sourcePagesOf(response)).toEqual([5, 2, 4, 1, 3]);
  });

  it("accepts the identity order", async () => {
    const response = await post(reorderPOST, {
      files: await pdfFile("doc.pdf", 3),
      order: "1,2,3",
    });
    expect(response.status).toBe(200);
    expect(await sourcePagesOf(response)).toEqual([1, 2, 3]);
  });

  it("rejects a request with no files", async () => {
    const response = await post(reorderPOST, { order: "1" });
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects two files", async () => {
    const form = new FormData();
    const a = await pdfFile("a.pdf", 2);
    const b = await pdfFile("b.pdf", 2);
    form.append("files", a, a.name);
    form.append("files", b, b.name);
    form.append("order", "1,2");

    const response = await reorderPOST(
      new Request("http://localhost/api/tools/reorder-pdf-pages", {
        method: "POST",
        body: form,
      }),
    );

    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe("TOO_MANY_FILES");
  });

  it("rejects a missing or empty order", async () => {
    const missing = await post(reorderPOST, { files: await pdfFile("a.pdf", 3) });
    expect(missing.status).toBe(400);
    expect((await errorBody(missing)).error.code).toBe("INVALID_PAGE_ORDER");

    const empty = await post(reorderPOST, {
      files: await pdfFile("a.pdf", 3),
      order: "   ",
    });
    expect((await errorBody(empty)).error.code).toBe("INVALID_PAGE_ORDER");
  });

  it("rejects invalid characters, duplicates, missing and out-of-range pages", async () => {
    const cases: [string, string][] = [
      ["abc", "INVALID_PAGE_ORDER"],
      ["1,2,2", "INVALID_PAGE_ORDER"],
      ["1,2", "INVALID_PAGE_ORDER"],
      // A 4th page does not exist in a 3-page document, so this is the more
      // precise out-of-range error rather than a generic order problem.
      ["1,2,3,4", "PAGE_OUT_OF_RANGE"],
      ["1,2,9", "PAGE_OUT_OF_RANGE"],
    ];

    for (const [order, code] of cases) {
      const response = await post(reorderPOST, {
        files: await pdfFile("a.pdf", 3),
        order,
      });
      expect(response.status, `order "${order}"`).toBe(400);
      expect((await errorBody(response)).error.code, `order "${order}"`).toBe(code);
    }
  });

  it("rejects a disguised non-PDF and a malformed PDF", async () => {
    const fake = new File([makeNonPdf() as BlobPart], "invoice.pdf", {
      type: "application/pdf",
    });
    const disguised = await post(reorderPOST, { files: fake, order: "1" });
    expect(disguised.status).toBe(422);
    expect((await errorBody(disguised)).error.code).toBe("INVALID_PDF");

    const broken = new File(
      [new TextEncoder().encode("%PDF-1.7 truncated") as BlobPart],
      "broken.pdf",
      { type: "application/pdf" },
    );
    const malformed = await post(reorderPOST, { files: broken, order: "1" });
    expect(malformed.status).toBe(422);
    expect((await errorBody(malformed)).error.code).toBe("INVALID_PDF");
  });

  it("rejects an unsupported file type", async () => {
    const image = new File(["nope"], "photo.png", { type: "image/png" });
    const response = await post(reorderPOST, { files: image, order: "1" });
    expect(response.status).toBe(415);
  });

  it("rejects a non-multipart request", async () => {
    const response = await reorderPOST(
      new Request("http://localhost/api/tools/reorder-pdf-pages", {
        method: "POST",
        body: JSON.stringify({ order: "1" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(response.status).toBe(400);
  });

  it("never leaks internals", async () => {
    const response = await post(reorderPOST, {
      files: await pdfFile("a.pdf", 3),
      order: "1,2,9",
    });
    const text = JSON.stringify(await errorBody(response));
    expect(text).not.toMatch(/stack|at Object|node_modules|pdf-lib|\/home\//i);
  });

  it("rejects GET", () => {
    const response = reorderGET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});

/* -------------------------------------------------------------------------- */
/* Thumbnail API                                                              */
/* -------------------------------------------------------------------------- */
describe("POST /api/documents/thumbnails", () => {
  it("returns real previews for the requested pages", async () => {
    const coloured = await makeColouredPdf(PAGE_COLOURS);
    const file = new File([coloured as BlobPart], "document.pdf", {
      type: "application/pdf",
    });

    const response = await post(thumbnailsPOST, { files: file, pages: "1,3,5" });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");

    const body = (await response.json()) as {
      pageCount: number;
      thumbnails: { pageNumber: number; width: number; height: number; dataUrl: string }[];
    };

    expect(body.pageCount).toBe(5);
    expect(body.thumbnails.map((t) => t.pageNumber)).toEqual([1, 3, 5]);

    // Page identity: decode each PNG and check the colour of that source page.
    for (const [index, page] of [1, 3, 5].entries()) {
      const thumbnail = body.thumbnails[index];
      expect(thumbnail.dataUrl.startsWith("data:image/png;base64,")).toBe(true);

      const png = Buffer.from(thumbnail.dataUrl.split(",")[1], "base64");
      const image = decodePng(new Uint8Array(png));
      expect(image.width).toBe(thumbnail.width);
      expect(image.height).toBe(thumbnail.height);
      expect(centerPixel(image).slice(0, 3)).toEqual(PAGE_COLOURS[page - 1]);
    }
  });

  it("renders every page when none are requested", async () => {
    const response = await post(thumbnailsPOST, { files: await pdfFile("a.pdf", 4) });
    const body = (await response.json()) as { thumbnails: { pageNumber: number }[] };
    expect(body.thumbnails.map((t) => t.pageNumber)).toEqual([1, 2, 3, 4]);
  });

  it("honours the configured page limit", async () => {
    vi.stubEnv("PDFKIT_THUMBNAIL_MAX_PAGES", "2");

    const capped = await post(thumbnailsPOST, { files: await pdfFile("a.pdf", 6) });
    const body = (await capped.json()) as { thumbnails: unknown[] };
    expect(body.thumbnails).toHaveLength(2);

    const tooMany = await post(thumbnailsPOST, {
      files: await pdfFile("a.pdf", 6),
      pages: "1,2,3",
    });
    expect(tooMany.status).toBe(413);
    expect((await errorBody(tooMany)).error.code).toBe("TOO_MANY_OUTPUTS");
  });

  it("honours the configured width", async () => {
    vi.stubEnv("PDFKIT_THUMBNAIL_WIDTH", "80");
    const response = await post(thumbnailsPOST, {
      files: await pdfFile("a.pdf", 1),
      pages: "1",
    });
    const body = (await response.json()) as { thumbnails: { width: number }[] };
    expect(body.thumbnails[0].width).toBe(80);
  });

  it("rejects invalid page numbers", async () => {
    for (const pages of ["abc", "0", "-1"]) {
      const response = await post(thumbnailsPOST, {
        files: await pdfFile("a.pdf", 3),
        pages,
      });
      expect(response.status, pages).toBe(400);
    }

    const beyond = await post(thumbnailsPOST, {
      files: await pdfFile("a.pdf", 3),
      pages: "9",
    });
    expect(beyond.status).toBe(400);
    expect((await errorBody(beyond)).error.code).toBe("PAGE_OUT_OF_RANGE");
  });

  it("rejects no files, two files and non-PDF content", async () => {
    const none = await post(thumbnailsPOST, { pages: "1" });
    expect(none.status).toBe(400);

    const form = new FormData();
    const a = await pdfFile("a.pdf", 1);
    const b = await pdfFile("b.pdf", 1);
    form.append("files", a, a.name);
    form.append("files", b, b.name);
    const two = await thumbnailsPOST(
      new Request("http://localhost/api/documents/thumbnails", {
        method: "POST",
        body: form,
      }),
    );
    expect(two.status).toBe(413);

    const fake = new File([makeNonPdf() as BlobPart], "invoice.pdf", {
      type: "application/pdf",
    });
    const disguised = await post(thumbnailsPOST, { files: fake });
    expect(disguised.status).toBe(422);
    expect((await errorBody(disguised)).error.code).toBe("INVALID_PDF");
  });

  it("rejects a file above the upload limit", async () => {
    vi.stubEnv("PDFKIT_MAX_UPLOAD_SIZE", "100");
    const response = await post(thumbnailsPOST, { files: await pdfFile("a.pdf", 3) });
    expect(response.status).toBe(413);
  });

  it("never leaks internals", async () => {
    const fake = new File([makeNonPdf() as BlobPart], "x.pdf", {
      type: "application/pdf",
    });
    const response = await post(thumbnailsPOST, { files: fake });
    const text = JSON.stringify(await errorBody(response));
    expect(text).not.toMatch(/stack|at Object|node_modules|wasm|pdfium|\/home\//i);
  });

  it("rejects GET", () => {
    expect(thumbnailsGET().status).toBe(405);
  });
});
