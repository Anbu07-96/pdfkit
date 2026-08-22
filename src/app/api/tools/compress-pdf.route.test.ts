// @vitest-environment node
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/tools/compress-pdf/route";
import {
  makeBrokenPdf,
  makeNonPdf,
  makeNumberedPdf,
  makeUncompressedPdf,
  pageWidths,
} from "@/test/pdf-fixtures";

async function call(
  options: {
    files?: File[];
    level?: string;
    omitLevel?: boolean;
    rawBody?: string;
  } = {},
) {
  if (options.rawBody !== undefined) {
    return POST(
      new Request("http://localhost/api/tools/compress-pdf", {
        method: "POST",
        body: options.rawBody,
        headers: { "content-type": "multipart/form-data" },
      }),
    );
  }

  const form = new FormData();
  for (const file of options.files ?? []) form.append("files", file, file.name);
  if (!options.omitLevel && options.level !== undefined) {
    form.append("level", options.level);
  }

  return POST(
    new Request("http://localhost/api/tools/compress-pdf", {
      method: "POST",
      body: form,
    }),
  );
}

async function pdfFile(name: string, pages: number): Promise<File> {
  const bytes = await makeNumberedPdf(pages);
  return new File([bytes as BlobPart], name, { type: "application/pdf" });
}

function uncompressedFile(name: string): File {
  const bytes = makeUncompressedPdf(4);
  return new File([bytes as BlobPart], name, { type: "application/pdf" });
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

describe("POST /api/tools/compress-pdf", () => {
  it.each(["low", "medium", "high"] as const)(
    "compresses at level %s and reports honest statistics",
    async (level) => {
      const file = uncompressedFile("invoice.pdf");
      const response = await call({ files: [file], level });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/pdf");
      expect(response.headers.get("content-disposition")).toBe(
        'attachment; filename="invoice-compressed.pdf"',
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");

      expect(response.headers.get("x-pdfkit-compression-level")).toBe(level);
      expect(response.headers.get("x-pdfkit-reduced")).toBe("yes");

      const originalBytes = Number(
        response.headers.get("x-pdfkit-original-bytes"),
      );
      const outputBytes = Number(response.headers.get("x-pdfkit-output-bytes"));
      const bytesSaved = Number(response.headers.get("x-pdfkit-bytes-saved"));
      const reduction = Number(
        response.headers.get("x-pdfkit-reduction-percent"),
      );

      expect(originalBytes).toBe(file.size);
      expect(outputBytes).toBeLessThan(originalBytes);
      expect(bytesSaved).toBe(originalBytes - outputBytes);
      expect(reduction).toBeCloseTo(
        Math.round((bytesSaved / originalBytes) * 1000) / 10,
        5,
      );
      // The reported output size is the real response size.
      expect(outputBytes).toBe(Number(response.headers.get("content-length")));

      expect(await sourcePagesOf(response)).toEqual([1, 2, 3, 4]);
    },
  );

  it("defaults to medium when the level is missing", async () => {
    const response = await call({
      files: [uncompressedFile("doc.pdf")],
      omitLevel: true,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-pdfkit-compression-level")).toBe("medium");
  });

  it("rejects an invalid level with 400", async () => {
    const response = await call({
      files: [await pdfFile("a.pdf", 2)],
      level: "extreme",
    });
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a request without files", async () => {
    const response = await call({ level: "medium" });
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects two files", async () => {
    const response = await call({
      files: [await pdfFile("a.pdf", 2), await pdfFile("b.pdf", 2)],
      level: "medium",
    });
    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe("TOO_MANY_FILES");
  });

  it("rejects a malformed PDF", async () => {
    const broken = new File(
      [makeBrokenPdf() as BlobPart],
      "broken.pdf",
      { type: "application/pdf" },
    );
    const response = await call({ files: [broken], level: "medium" });
    expect(response.status).toBe(422);
    expect((await errorBody(response)).error.code).toBe("INVALID_PDF");
  });

  it("rejects a disguised non-PDF", async () => {
    const fake = new File(
      [makeNonPdf() as BlobPart],
      "document.pdf",
      { type: "application/pdf" },
    );
    const response = await call({ files: [fake], level: "medium" });
    expect(response.status).toBe(422);
    expect((await errorBody(response)).error.code).toBe("INVALID_PDF");
  });

  it("rejects an oversized file", async () => {
    vi.stubEnv("PDFKIT_MAX_UPLOAD_SIZE", "100");
    const response = await call({
      files: [await pdfFile("big.pdf", 3)],
      level: "medium",
    });
    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe("FILE_TOO_LARGE");
  });

  it("reports no savings honestly for an already-optimised PDF", async () => {
    // Our own output, compressed again: nothing left to squeeze.
    const first = await call({ files: [uncompressedFile("doc.pdf")], level: "medium" });
    const firstBytes = new Uint8Array(await first.arrayBuffer());
    const again = new File([firstBytes as BlobPart], "doc-compressed.pdf", {
      type: "application/pdf",
    });
    const response = await call({ files: [again], level: "medium" });

    expect(response.status).toBe(200);
    if (response.headers.get("x-pdfkit-reduced") === "no") {
      expect(response.headers.get("x-pdfkit-bytes-saved")).toBe("0");
      expect(response.headers.get("x-pdfkit-reduction-percent")).toBe("0");
      expect(response.headers.get("x-pdfkit-compression-strategy")).toBe(
        "original",
      );
      // The original bytes come back untouched.
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(firstBytes);
    } else {
      expect(Number(response.headers.get("x-pdfkit-output-bytes"))).toBeLessThan(
        firstBytes.length,
      );
    }
  });

  it("sanitises hostile filenames in the disposition header", async () => {
    const response = await call({
      files: [uncompressedFile('../../etc/passwd.pdf')],
      level: "low",
    });
    expect(response.status).toBe(200);
    const disposition = response.headers.get("content-disposition") ?? "";
    expect(disposition).toContain('filename="passwd-compressed.pdf"');
    expect(disposition).not.toMatch(/\.\.|\/|\\/);
  });

  it("never leaks internals in errors", async () => {
    const broken = new File([makeBrokenPdf() as BlobPart], "b.pdf", {
      type: "application/pdf",
    });
    const response = await call({ files: [broken], level: "medium" });
    const text = JSON.stringify(await errorBody(response));
    expect(text).not.toMatch(/stack|at Object|node_modules|pdf-lib|\/home\//i);
  });

  it("rejects GET", () => {
    expect(GET().status).toBe(405);
  });
});

describe("POST /api/tools/compress-pdf with a header-hostile filename", () => {
  it("survives extended-Latin filenames that headers cannot carry", async () => {
    // Regression (Phase 9): Ő (U+0150) used to pass the filename sanitiser and
    // made the Response constructor throw, failing the request as an
    // unstructured 500. The name must be neutralised and the job must succeed.
    const file = uncompressedFile("Ő-document.pdf");
    const response = await call({ files: [file], level: "low" });

    expect(response.status).toBe(200);
    const disposition = response.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("filename=");
    expect(disposition).not.toMatch(/[^\u0000-\u00ff]/);
    expect(response.headers.get("x-pdfkit-reduced")).toBe("yes");
    await sourcePagesOf(response);
  });
});
