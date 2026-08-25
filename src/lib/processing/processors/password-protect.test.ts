// @vitest-environment node
import { describe, expect, it } from "vitest";
import { encryptPDF } from "@pdfsmaller/pdf-encrypt-lite";
import { decryptPDF, isEncrypted } from "@pdfsmaller/pdf-decrypt-lite";
import { PDFDocument } from "pdf-lib";
import { ProcessingError } from "@/lib/processing/errors";
import { passwordProtectProcessor } from "@/lib/processing/processors/password-protect";
import {
  makeBrokenPdf,
  makeNumberedPdf,
  makePdf,
} from "@/test/pdf-fixtures";


async function pdfInput(name: string, bytes: Uint8Array) {
  return {
    id: `input-${name}`,
    name,
    mimeType: "application/pdf",
    size: bytes.length,
    bytes,
  };
}

async function expectProcessingError(
  promise: Promise<unknown>,
  code: string,
): Promise<ProcessingError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProcessingError);
    expect((error as ProcessingError).code).toBe(code);
    return error as ProcessingError;
  }
  throw new Error(`expected a ProcessingError (${code})`);
}

describe("password-protect processor", () => {
  it("encrypts a real PDF and reports honest metadata", async () => {
    const bytes = await makeNumberedPdf(3);
    const result = await passwordProtectProcessor.process(
      {
        toolId: "password-protect",
        files: [await pdfInput("report.pdf", bytes)],
        options: { password: "s3cret pass" },
      },
    );

    expect(result.status).toBe("succeeded");
    expect(result.artifacts).toHaveLength(1);
    const artifact = result.artifacts[0];
    expect(artifact.name).toBe("report-protected.pdf");
    expect(artifact.mimeType).toBe("application/pdf");
    expect(artifact.size).toBe(artifact.bytes.length);
    expect(result.meta).toMatchObject({ pages: 3, outputPages: 3 });
  });

  it("produces output that genuinely requires the password", async () => {
    const bytes = await makePdf(["Hello"]);
    const password = "Correct Horse 42!";
    const result = await passwordProtectProcessor.process(
      {
        toolId: "password-protect",
        files: [await pdfInput("doc.pdf", bytes)],
        options: { password },
      },
    );

    const output = result.artifacts[0].bytes;

    // 1. It declares RC4 128-bit (Standard Security V2/R3) — exactly what the
    //    copy promises, nothing stronger.
    const info = await isEncrypted(output);
    expect(info).toMatchObject({
      encrypted: true,
      version: 2,
      revision: 3,
      keyLength: 128,
    });

    // 2. It cannot be opened without the password.
    await expect(PDFDocument.load(output)).rejects.toThrow(/encrypted/i);

    // 3. The exact password given opens it again, with every page intact.
    const unlocked = await decryptPDF(output, password);
    const reopened = await PDFDocument.load(unlocked);
    expect(reopened.getPageCount()).toBe(1);

    // 4. A different password does not open it.
    await expect(decryptPDF(output, `${password}-wrong`)).rejects.toThrow(
      /incorrect password/i,
    );
  });

  it("refuses an already-encrypted PDF without leaking the password", async () => {
    const password = "topsecret-value";
    const encrypted = await encryptPDF(await makePdf(["locked"]), "first-pass");

    const error = await expectProcessingError(
      passwordProtectProcessor.process(
        {
          toolId: "password-protect",
          files: [await pdfInput("locked.pdf", encrypted)],
          options: { password },
        },
      ),
      "ENCRYPTED_PDF",
    );

    expect(error.message).toMatch(/already has a password/i);
    // The submitted password must never appear in any user-visible field.
    const serialised = JSON.stringify({
      message: error.message,
      details: error.details,
    });
    expect(serialised).not.toContain(password);
  });

  it("rejects an empty password", async () => {
    const error = await expectProcessingError(
      passwordProtectProcessor.process(
        {
          toolId: "password-protect",
          files: [await pdfInput("doc.pdf", await makePdf(["A"]))],
          options: { password: "" },
        },
      ),
      "VALIDATION_ERROR",
    );
    expect(error.message).toMatch(/choose a password/i);
  });

  it("rejects an overlong password", async () => {
    await expectProcessingError(
      passwordProtectProcessor.process(
        {
          toolId: "password-protect",
          files: [await pdfInput("doc.pdf", await makePdf(["A"]))],
          options: { password: "x".repeat(129) },
        },
      ),
      "VALIDATION_ERROR",
    );
  });

  it("rejects characters the legacy security handler cannot use", async () => {
    const password = "机密-passw0rd";
    const error = await expectProcessingError(
      passwordProtectProcessor.process(
        {
          toolId: "password-protect",
          files: [await pdfInput("doc.pdf", await makePdf(["A"]))],
          options: { password },
        },
      ),
      "VALIDATION_ERROR",
    );
    expect(error.message).toMatch(/Latin/i);
    expect(
      JSON.stringify({ message: error.message, details: error.details }),
    ).not.toContain(password);
  });

  it("reports an unreadable PDF as INVALID_PDF", async () => {
    await expectProcessingError(
      passwordProtectProcessor.process(
        {
          toolId: "password-protect",
          files: [await pdfInput("broken.pdf", makeBrokenPdf())],
          options: { password: "pw" },
        },
      ),
      "INVALID_PDF",
    );
  });

  it("fails cleanly when no file is provided", async () => {
    await expectProcessingError(
      passwordProtectProcessor.process(
        {
          toolId: "password-protect",
          files: [],
          options: { password: "pw" },
        },
      ),
      "VALIDATION_ERROR",
    );
  });
});
