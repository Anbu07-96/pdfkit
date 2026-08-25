// @vitest-environment node
import { describe, expect, it } from "vitest";
import { encryptPDF } from "@pdfsmaller/pdf-encrypt-lite";
import { decryptPDF, isEncrypted } from "@pdfsmaller/pdf-decrypt-lite";
import { PDFDocument } from "pdf-lib";
import { GET, POST } from "@/app/api/tools/password-protect/route";
import {
  makeBrokenPdf,
  makeNonPdf,
  makeNumberedPdf,
  makePdf,
} from "@/test/pdf-fixtures";

async function call(files: File[], fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return POST(
    new Request("http://localhost/api/tools/password-protect", {
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

describe("POST /api/tools/password-protect", () => {
  it("returns the protected PDF with the standard headers", async () => {
    const response = await call([await pdfFile("contract.pdf", 4)], {
      password: "Open-Sesame 7",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="contract-protected.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-pdfkit-pages")).toBe("4");
    expect(response.headers.get("x-pdfkit-output-pages")).toBe("4");
    expect(response.headers.get("x-pdfkit-artifacts")).toBe("1");

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Number(response.headers.get("content-length"))).toBe(bytes.length);

    // The delivered bytes are honestly encrypted RC4 128-bit (V2/R3)…
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(await isEncrypted(bytes)).toMatchObject({
      encrypted: true,
      version: 2,
      revision: 3,
      keyLength: 128,
    });
    // …they refuse to open without the password…
    await expect(PDFDocument.load(bytes)).rejects.toThrow(/encrypted/i);
    // …and the submitted password reopens every page.
    const unlocked = await decryptPDF(bytes, "Open-Sesame 7");
    expect((await PDFDocument.load(unlocked)).getPageCount()).toBe(4);

    // The password itself travels nowhere in the response.
    for (const [name, value] of response.headers.entries()) {
      expect(`${name}: ${value}`).not.toContain("Open-Sesame 7");
    }
  });

  it("rejects a missing or empty password with 400", async () => {
    const cases: Record<string, string>[] = [{}, { password: "" }];
    for (const fields of cases) {
      const response = await call([await pdfFile("doc.pdf", 1)], fields);
      expect(response.status).toBe(400);
      expect((await errorBody(response)).error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("refuses an already-protected PDF with 422 and no password leak", async () => {
    const password = "second-s3cret";
    const encrypted = await encryptPDF(await makePdf(["locked"]), "first-s3cret");
    const file = new File([encrypted as BlobPart], "locked.pdf", {
      type: "application/pdf",
    });

    const response = await call([file], { password });
    expect(response.status).toBe(422);

    const body = await errorBody(response);
    expect(body.error.code).toBe("ENCRYPTED_PDF");
    expect(JSON.stringify(body)).not.toContain(password);
    expect(JSON.stringify(body)).not.toContain("first-s3cret");
  });

  it("reports a broken PDF with 422", async () => {
    const broken = new File([makeBrokenPdf() as BlobPart], "broken.pdf", {
      type: "application/pdf",
    });
    const response = await call([broken], { password: "pw" });
    expect(response.status).toBe(422);
    expect((await errorBody(response)).error.code).toBe("INVALID_PDF");
  });

  it("rejects content that is not a PDF", async () => {
    const notPdf = new File([makeNonPdf() as BlobPart], "fake.pdf", {
      type: "application/pdf",
    });
    const response = await call([notPdf], { password: "pw" });
    expect((await errorBody(response)).error.code).toBe("INVALID_PDF");
  });

  it("rejects more than one file", async () => {
    const response = await call(
      [await pdfFile("a.pdf", 1), await pdfFile("b.pdf", 1)],
      { password: "pw" },
    );
    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe("TOO_MANY_FILES");
  });
});

describe("GET /api/tools/password-protect", () => {
  it("explains that only POST exists", () => {
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});
