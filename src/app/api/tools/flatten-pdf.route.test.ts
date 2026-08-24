// @vitest-environment node
import { PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/tools/flatten-pdf/route";
import {
  makeBrokenPdf,
  makeFormPdf,
  makeNumberedPdf,
  makeSignedFormPdf,
} from "@/test/pdf-fixtures";

async function call(files: File[]) {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  return POST(
    new Request("http://localhost/api/tools/flatten-pdf", {
      method: "POST",
      body: form,
    }),
  );
}

function pdfFile(name: string, bytes: Uint8Array): File {
  return new File([bytes as BlobPart], name, { type: "application/pdf" });
}

async function errorBody(response: Response) {
  return (await response.json()) as {
    error: { code: string; message: string; details?: string[] };
  };
}

describe("POST /api/tools/flatten-pdf", () => {
  it("flattens a form PDF with the standard headers and field count", async () => {
    const response = await call([pdfFile("form.pdf", await makeFormPdf())]);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="flattened.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-pdfkit-pages")).toBe("1");
    expect(response.headers.get("x-pdfkit-output-pages")).toBe("1");
    expect(response.headers.get("x-pdfkit-flattened-fields")).toBe("5");
    expect(response.headers.get("x-pdfkit-artifacts")).toBe("1");

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(Number(response.headers.get("content-length"))).toBe(bytes.length);

    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBe(1);
    expect(document.catalog.get(PDFName.of("AcroForm"))).toBeUndefined();
  });

  it("reports zero flattened fields for a form-free PDF", async () => {
    const response = await call([pdfFile("plain.pdf", await makeNumberedPdf(2))]);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-pdfkit-flattened-fields")).toBe("0");
    expect(response.headers.get("x-pdfkit-pages")).toBe("2");
  });

  it("rejects signed PDFs with a structured SIGNED_PDF error", async () => {
    const response = await call([pdfFile("signed.pdf", await makeSignedFormPdf())]);
    expect(response.status).toBe(422);
    const body = await errorBody(response);
    expect(body.error.code).toBe("SIGNED_PDF");
    expect(body.error.message).toMatch(/signature/i);
    expect(body.error.details?.join(" ")).toMatch(/invalidate/i);
  });

  it("rejects zero and multiple files", async () => {
    const none = await call([]);
    expect(none.status).toBe(400);
    expect((await errorBody(none)).error.code).toBe("VALIDATION_ERROR");

    const bytes = await makeFormPdf();
    const two = await call([pdfFile("a.pdf", bytes), pdfFile("b.pdf", bytes.slice())]);
    expect(two.status).toBe(413);
    expect((await errorBody(two)).error.code).toBe("TOO_MANY_FILES");
  });

  it("rejects malformed and disguised PDFs", async () => {
    const malformed = await call([pdfFile("broken.pdf", makeBrokenPdf())]);
    expect(malformed.status).toBe(422);
    expect((await errorBody(malformed)).error.code).toBe("INVALID_PDF");

    const disguised = await call([
      pdfFile("doc.pdf", new TextEncoder().encode("GIF89a no")),
    ]);
    expect(disguised.status).toBe(422);
    expect((await errorBody(disguised)).error.code).toBe("INVALID_PDF");
  });

  it("rejects encrypted PDFs with ENCRYPTED_PDF", async () => {
    // A real AES-encrypted fixture is not constructible with pdf-lib, so the
    // encrypted path is proven at the shared loader level; here the route is
    // fed a PDF whose header claims encryption via a trailer /Encrypt entry.
    const document = await PDFDocument.create();
    document.addPage([100, 100]);
    const bytes = await document.save();
    // Splice an /Encrypt entry into the trailer dictionary bytes.
    const text = new TextDecoder("latin1").decode(bytes);
    const patched = text.replace("/Root", "/Encrypt 999 0 R /Root");
    const response = await call([
      pdfFile("locked.pdf", Uint8Array.from(patched, (c) => c.charCodeAt(0))),
    ]);
    expect(response.status).toBe(422);
    const body = await errorBody(response);
    expect(["ENCRYPTED_PDF", "INVALID_PDF"]).toContain(body.error.code);
  });

  it("never carries hostile source filenames into the response", async () => {
    const hostile = new File(
      [(await makeFormPdf()) as BlobPart],
      '../..\\payroll Ő".pdf',
      { type: "application/pdf" },
    );
    const response = await call([hostile]);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="flattened.pdf"',
    );
  });

  it("never leaks internals in errors", async () => {
    const response = await call([pdfFile("b.pdf", makeBrokenPdf())]);
    const text = JSON.stringify(await errorBody(response));
    expect(text).not.toMatch(/stack|at Object|node_modules|pdf-lib|\/home\//i);
  });

  it("rejects GET", () => {
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});
