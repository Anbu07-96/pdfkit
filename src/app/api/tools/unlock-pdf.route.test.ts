// @vitest-environment node
import { describe, expect, it } from "vitest";
import { encryptPDF } from "@pdfsmaller/pdf-encrypt-lite";
import { PDFDocument } from "pdf-lib";
import { GET, POST } from "@/app/api/tools/unlock-pdf/route";
import {
  makeBrokenPdf,
  makeNumberedPdf,
  makePdf,
  pageWidths,
} from "@/test/pdf-fixtures";

async function call(files: File[], fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return POST(
    new Request("http://localhost/api/tools/unlock-pdf", {
      method: "POST",
      body: form,
    }),
  );
}

async function encryptedFile(
  name: string,
  password: string,
  labels: string[] = ["locked"],
): Promise<File> {
  const bytes = await encryptPDF(await makePdf(labels), password);
  return new File([bytes as BlobPart], name, { type: "application/pdf" });
}

async function errorBody(response: Response) {
  return (await response.json()) as {
    error: { code: string; message: string; details?: string[] };
  };
}

describe("POST /api/tools/unlock-pdf", () => {
  it("returns the unlocked PDF with the standard headers", async () => {
    const password = "Client-Secret 9";
    const file = await encryptedFile("invoice.pdf", password, ["A", "B", "C"]);

    const response = await call([file], { password });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="invoice-unlocked.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-pdfkit-pages")).toBe("3");
    expect(response.headers.get("x-pdfkit-output-pages")).toBe("3");
    expect(response.headers.get("x-pdfkit-artifacts")).toBe("1");

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Number(response.headers.get("content-length"))).toBe(bytes.length);

    // An ordinary PDF again: opens with no password, all pages intact.
    const unlocked = await PDFDocument.load(bytes);
    expect(unlocked.getPageCount()).toBe(3);

    // The password travels nowhere in the response.
    for (const [name, value] of response.headers.entries()) {
      expect(`${name}: ${value}`).not.toContain(password);
    }
  });

  it("round-trips through both tools end to end", async () => {
    // Protect with the real route, then unlock with this one: the final bytes
    // must be an ordinary document carrying every original page in order.
    const { POST: protectPost } = await import(
      "@/app/api/tools/password-protect/route"
    );
    const plain = await makeNumberedPdf(4);
    const protectForm = new FormData();
    protectForm.append(
      "files",
      new File([plain as BlobPart], "doc.pdf", { type: "application/pdf" }),
    );
    protectForm.append("password", "round-trip pw");
    const protectedResponse = await protectPost(
      new Request("http://localhost/api/tools/password-protect", {
        method: "POST",
        body: protectForm,
      }),
    );
    expect(protectedResponse.status).toBe(200);
    const protectedBytes = new Uint8Array(await protectedResponse.arrayBuffer());
    await expect(PDFDocument.load(protectedBytes)).rejects.toThrow(/encrypted/i);

    const unlockResponse = await call(
      [
        new File([protectedBytes as BlobPart], "doc-protected.pdf", {
          type: "application/pdf",
        }),
      ],
      { password: "round-trip pw" },
    );
    expect(unlockResponse.status).toBe(200);

    const unlockedBytes = new Uint8Array(await unlockResponse.arrayBuffer());
    const unlocked = await PDFDocument.load(unlockedBytes);
    expect(unlocked.getPageCount()).toBe(4);
    expect(pageWidths(unlocked)).toEqual([101, 102, 103, 104]);
  });

  it("rejects an unprotected PDF with PDF_NOT_ENCRYPTED", async () => {
    const plain = new File([await makePdf(["plain"]) as BlobPart], "plain.pdf", {
      type: "application/pdf",
    });
    const response = await call([plain], { password: "pw" });
    expect(response.status).toBe(422);
    const body = await errorBody(response);
    expect(body.error.code).toBe("PDF_NOT_ENCRYPTED");
  });

  it("rejects a wrong password with WRONG_PASSWORD and no leak", async () => {
    const wrongEntry = "not-the-password-55";
    const file = await encryptedFile("locked.pdf", "the-real-one");
    const response = await call([file], { password: wrongEntry });
    expect(response.status).toBe(422);
    const body = await errorBody(response);
    expect(body.error.code).toBe("WRONG_PASSWORD");
    expect(JSON.stringify(body)).not.toContain(wrongEntry);
    expect(JSON.stringify(body)).not.toContain("the-real-one");
  });

  it("unlocks a file with an empty user password via an empty entry", async () => {
    const file = await encryptedFile("restricted.pdf", "");
    const response = await call([file], { password: "" });
    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("reports a broken PDF with 422", async () => {
    const broken = new File([makeBrokenPdf() as BlobPart], "broken.pdf", {
      type: "application/pdf",
    });
    const response = await call([broken], { password: "pw" });
    expect(response.status).toBe(422);
    expect((await errorBody(response)).error.code).toBe("INVALID_PDF");
  });
});

describe("GET /api/tools/unlock-pdf", () => {
  it("explains that only POST exists", () => {
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});
