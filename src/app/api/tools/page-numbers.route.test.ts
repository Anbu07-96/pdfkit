// @vitest-environment node
import { describe, expect, it, vi, afterEach } from "vitest";
import { GET, POST } from "@/app/api/tools/page-numbers/route";
import { makeBrokenPdf, makeNumberedPdf } from "@/test/pdf-fixtures";

const VALID = {
  position: "bottom-center",
  start: "1",
  size: "11",
  format: "page-of",
  pages: "all",
};

async function call(files: File[], fields: Record<string, string> = VALID) {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return POST(
    new Request("http://localhost/api/tools/page-numbers", {
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

describe("POST /api/tools/page-numbers", () => {
  it("returns the numbered PDF with the standard headers", async () => {
    const response = await call([await pdfFile("report.pdf", 4)]);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="report-numbered.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-pdfkit-pages")).toBe("4");
    expect(response.headers.get("x-pdfkit-output-pages")).toBe("4");
    expect(response.headers.get("x-pdfkit-numbered-pages")).toBe("4");
    expect(response.headers.get("x-pdfkit-artifacts")).toBe("1");

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(Number(response.headers.get("content-length"))).toBe(bytes.length);
  });

  it("reports the numbered count for page-limited numbering", async () => {
    const response = await call([await pdfFile("doc.pdf", 5)], {
      ...VALID,
      pages: "last",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-pdfkit-numbered-pages")).toBe("1");
    expect(response.headers.get("x-pdfkit-pages")).toBe("5");
  });

  it("rejects an invalid option with 400", async () => {
    for (const patch of [
      { position: "middle" },
      { start: "0" },
      { start: "abc" },
      { size: "30" },
      { size: "7" },
      { format: "roman" },
      { pages: "even" },
    ]) {
      const response = await call([await pdfFile("a.pdf", 1)], {
        ...VALID,
        ...patch,
      });
      expect(response.status, JSON.stringify(patch)).toBe(400);
      expect((await errorBody(response)).error.code).toBe(
        "INVALID_PAGE_NUMBER_CONFIGURATION",
      );
    }
  });

  it("rejects zero and multiple files", async () => {
    const none = await call([]);
    expect(none.status).toBe(400);
    expect((await errorBody(none)).error.code).toBe("VALIDATION_ERROR");

    const two = await call([await pdfFile("a.pdf", 1), await pdfFile("b.pdf", 1)]);
    expect(two.status).toBe(413);
    expect((await errorBody(two)).error.code).toBe("TOO_MANY_FILES");
  });

  it("rejects malformed and disguised PDFs", async () => {
    const broken = new File([makeBrokenPdf() as BlobPart], "broken.pdf", {
      type: "application/pdf",
    });
    const malformed = await call([broken]);
    expect(malformed.status).toBe(422);
    expect((await errorBody(malformed)).error.code).toBe("INVALID_PDF");

    const fake = new File(
      [new TextEncoder().encode("GIF89a no") as BlobPart],
      "doc.pdf",
      { type: "application/pdf" },
    );
    const disguised = await call([fake]);
    expect(disguised.status).toBe(422);
    expect((await errorBody(disguised)).error.code).toBe("INVALID_PDF");
  });

  it("sanitises hostile filenames in the disposition header", async () => {
    const bytes = await makeNumberedPdf(1);
    const hostile = new File([bytes as BlobPart], "../..\\final Ő.pdf", {
      type: "application/pdf",
    });
    const response = await call([hostile]);
    expect(response.status).toBe(200);
    const disposition = response.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("numbered.pdf");
    expect(disposition).not.toMatch(/\.\.|[^\u0000-\u00ff]/);
  });

  it("never leaks internals in errors", async () => {
    const broken = new File([makeBrokenPdf() as BlobPart], "b.pdf", {
      type: "application/pdf",
    });
    const response = await call([broken]);
    const text = JSON.stringify(await errorBody(response));
    expect(text).not.toMatch(/stack|at Object|node_modules|pdf-lib|\/home\//i);
  });

  it("rejects GET", () => {
    expect(GET().status).toBe(405);
  });
});
