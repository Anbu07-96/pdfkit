// @vitest-environment node
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/tools/merge-pdf/route";
import { makeNonPdf, makePdfFile } from "@/test/pdf-fixtures";

function postRequest(form: FormData, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/tools/merge-pdf", {
    method: "POST",
    body: form,
    headers,
  });
}

async function formWith(files: File[]) {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  return form;
}

async function errorBody(response: Response) {
  return (await response.json()) as {
    error: { code: string; message: string; details?: string[] };
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/tools/merge-pdf", () => {
  it("merges uploaded PDFs and returns a real document", async () => {
    const form = await formWith([
      await makePdfFile("first.pdf", ["A", "B"]),
      await makePdfFile("second.pdf", ["C"]),
    ]);

    const response = await POST(postRequest(form));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="merged.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-pdfkit-pages")).toBe("3");

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");

    const merged = await PDFDocument.load(bytes);
    expect(merged.getPageCount()).toBe(3);
  });

  it("keeps the order the client sent", async () => {
    const a = await makePdfFile("a.pdf", ["A"]);
    const b = await makePdfFile("b.pdf", ["B", "C"]);

    const forward = await POST(postRequest(await formWith([a, b])));
    const reversed = await POST(postRequest(await formWith([b, a])));

    const forwardBytes = Buffer.from(await forward.arrayBuffer());
    const reversedBytes = Buffer.from(await reversed.arrayBuffer());

    expect(forwardBytes.equals(reversedBytes)).toBe(false);
  });

  it("rejects a request with a single file", async () => {
    const response = await POST(
      postRequest(await formWith([await makePdfFile("only.pdf")])),
    );

    expect(response.status).toBe(400);
    const body = await errorBody(response);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toMatch(/at least 2 files/i);
  });

  it("rejects a request with no files", async () => {
    const response = await POST(postRequest(new FormData()));
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a non-multipart request", async () => {
    const response = await POST(
      new Request("http://localhost/api/tools/merge-pdf", {
        method: "POST",
        body: JSON.stringify({ files: [] }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects files that are not PDFs even when named .pdf", async () => {
    const fake = new File([makeNonPdf() as BlobPart], "invoice.pdf", {
      type: "application/pdf",
    });
    const response = await POST(
      postRequest(await formWith([await makePdfFile("real.pdf"), fake])),
    );

    expect(response.status).toBe(422);
    const body = await errorBody(response);
    expect(body.error.code).toBe("INVALID_PDF");
    expect(body.error.details?.[0]).toContain("invoice.pdf");
  });

  it("rejects unsupported file types", async () => {
    const image = new File(["not-a-pdf"], "photo.png", { type: "image/png" });
    const response = await POST(
      postRequest(await formWith([await makePdfFile("real.pdf"), image])),
    );

    expect(response.status).toBe(415);
    expect((await errorBody(response)).error.code).toBe("UNSUPPORTED_FILE");
  });

  it("rejects a single file above the per-file limit", async () => {
    vi.stubEnv("PDFKIT_MAX_UPLOAD_SIZE", "100");

    const response = await POST(
      postRequest(
        await formWith([
          await makePdfFile("a.pdf", ["A"]),
          await makePdfFile("b.pdf", ["B"]),
        ]),
      ),
    );

    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe("FILE_TOO_LARGE");
  });

  it("rejects too many files before reading them", async () => {
    vi.stubEnv("PDFKIT_MAX_FILES_PER_JOB", "2");

    const response = await POST(
      postRequest(
        await formWith([
          await makePdfFile("a.pdf"),
          await makePdfFile("b.pdf"),
          await makePdfFile("c.pdf"),
        ]),
      ),
    );

    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe("TOO_MANY_FILES");
  });

  it("rejects an oversized request from the content-length header alone", async () => {
    vi.stubEnv("PDFKIT_MAX_UPLOAD_SIZE", "1000");
    vi.stubEnv("PDFKIT_MAX_TOTAL_UPLOAD_SIZE", "1000");

    // `content-length` is a forbidden header on a real Request, so the check is
    // exercised through a minimal stand-in with the same shape.
    const form = await formWith([await makePdfFile("a.pdf")]);
    const readBody = vi.fn(async () => form);
    const request = {
      headers: new Headers({
        "content-type": "multipart/form-data; boundary=----pdfkit",
        "content-length": "5000000",
      }),
      formData: readBody,
    } as unknown as Request;

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe("TOTAL_SIZE_EXCEEDED");
    // The body must be rejected before it is read into memory.
    expect(readBody).not.toHaveBeenCalled();
  });

  it("never leaks internals in an error response", async () => {
    const response = await POST(
      postRequest(await formWith([await makePdfFile("only.pdf")])),
    );
    const text = JSON.stringify(await errorBody(response));

    expect(text).not.toMatch(/stack|at Object|node_modules|pdf-lib/i);
  });
});

describe("GET /api/tools/merge-pdf", () => {
  it("is not allowed", () => {
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});
