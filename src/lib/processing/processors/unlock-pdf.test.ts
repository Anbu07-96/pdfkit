// @vitest-environment node
import { describe, expect, it } from "vitest";
import { encryptPDF } from "@pdfsmaller/pdf-encrypt-lite";
import { decryptPDF } from "@pdfsmaller/pdf-decrypt-lite";
import { PDFDocument, PDFHexString, PDFName, PDFNumber } from "pdf-lib";
import { ProcessingError } from "@/lib/processing/errors";
import { unlockPdfProcessor } from "@/lib/processing/processors/unlock-pdf";
import {
  makeBrokenPdf,
  makeNumberedPdf,
  makePdf,
  pageWidths,
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

/**
 * A valid PDF whose trailer declares an AES-class encryption dictionary
 * (V4/R4) without real AES-encrypted contents. This exercises the version
 * gate only — it is NOT a genuine AES fixture (a known gap, owned by a later
 * phase): the processor must refuse before attempting decryption.
 */
async function makeFakeAesEncryptedPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([200, 200]);
  const context = document.context;
  const encryptDict = context.obj({
    Filter: PDFName.of("Standard"),
    V: PDFNumber.of(4),
    R: PDFNumber.of(4),
    Length: PDFNumber.of(128),
    P: PDFNumber.of(-4),
    O: PDFHexString.of("00".repeat(32)),
    U: PDFHexString.of("00".repeat(32)),
  });
  context.trailerInfo.Encrypt = context.register(encryptDict);
  return document.save({ useObjectStreams: false });
}

describe("unlock-pdf processor", () => {
  it("round-trips: protect → unlock produces an ordinary PDF again", async () => {
    const original = await makeNumberedPdf(3);
    const password = "S3cure Pass!";
    const encrypted = await encryptPDF(original, password);

    const result = await unlockPdfProcessor.process(
      {
        toolId: "unlock-pdf",
        files: [await pdfInput("report.pdf", encrypted)],
        options: { password },
      },
    );

    expect(result.status).toBe("succeeded");
    const artifact = result.artifacts[0];
    expect(artifact.name).toBe("report-unlocked.pdf");
    expect(artifact.mimeType).toBe("application/pdf");
    expect(artifact.size).toBe(artifact.bytes.length);
    expect(result.meta).toMatchObject({ pages: 3, outputPages: 3 });

    // The output is an ordinary PDF: it opens without any password (proving
    // /Encrypt is really stripped) and carries every original page in order.
    const unlocked = await PDFDocument.load(artifact.bytes);
    expect(unlocked.getPageCount()).toBe(3);
    expect(pageWidths(unlocked)).toEqual([101, 102, 103]);
  });

  it("unlocks a file with an empty user password using an empty entry", async () => {
    const encrypted = await encryptPDF(await makePdf(["restricted"]), "");
    const result = await unlockPdfProcessor.process(
      {
        toolId: "unlock-pdf",
        files: [await pdfInput("restricted.pdf", encrypted)],
        options: { password: "" },
      },
    );
    expect(result.status).toBe("succeeded");
    expect((await PDFDocument.load(result.artifacts[0].bytes)).getPageCount()).toBe(1);
  });

  it("rejects an unprotected PDF with PDF_NOT_ENCRYPTED", async () => {
    const error = await expectProcessingError(
      unlockPdfProcessor.process(
        {
          toolId: "unlock-pdf",
          files: [await pdfInput("plain.pdf", await makePdf(["plain"]))],
          options: { password: "anything" },
        },
      ),
      "PDF_NOT_ENCRYPTED",
    );
    expect(error.message).toMatch(/not password-protected/i);
  });

  it("rejects a wrong password with WRONG_PASSWORD and never echoes it", async () => {
    const wrongEntry = "wrong-entry-987";
    const encrypted = await encryptPDF(await makePdf(["locked"]), "right-entry");

    const error = await expectProcessingError(
      unlockPdfProcessor.process(
        {
          toolId: "unlock-pdf",
          files: [await pdfInput("locked.pdf", encrypted)],
          options: { password: wrongEntry },
        },
      ),
      "WRONG_PASSWORD",
    );

    expect(error.message).toMatch(/does not unlock/i);
    expect(
      JSON.stringify({ message: error.message, details: error.details }),
    ).not.toContain(wrongEntry);
  });

  it("refuses AES-class encryption with UNSUPPORTED_ENCRYPTION", async () => {
    const fakeAes = await makeFakeAesEncryptedPdf();
    const error = await expectProcessingError(
      unlockPdfProcessor.process(
        {
          toolId: "unlock-pdf",
          files: [await pdfInput("aes.pdf", fakeAes)],
          options: { password: "pw" },
        },
      ),
      "UNSUPPORTED_ENCRYPTION",
    );
    expect(error.message).toMatch(/AES/);
    expect(error.message).toMatch(/RC4/);
  });

  it("reports an unreadable PDF as INVALID_PDF", async () => {
    await expectProcessingError(
      unlockPdfProcessor.process(
        {
          toolId: "unlock-pdf",
          files: [await pdfInput("broken.pdf", makeBrokenPdf())],
          options: { password: "pw" },
        },
      ),
      "INVALID_PDF",
    );
  });

  it("rejects an overlong password entry", async () => {
    const encrypted = await encryptPDF(await makePdf(["locked"]), "pw");
    await expectProcessingError(
      unlockPdfProcessor.process(
        {
          toolId: "unlock-pdf",
          files: [await pdfInput("locked.pdf", encrypted)],
          options: { password: "x".repeat(129) },
        },
      ),
      "VALIDATION_ERROR",
    );
  });

  it("fails cleanly when no file is provided", async () => {
    await expectProcessingError(
      unlockPdfProcessor.process(
        { toolId: "unlock-pdf", files: [], options: { password: "" } },
      ),
      "VALIDATION_ERROR",
    );
  });

  it("sanity-checks the fixture path with the library directly", async () => {
    // Independent confirmation that decryptPDF agrees with the processor's
    // mapping: the same bytes the library rejects as "not encrypted" are the
    // ones the processor reports as PDF_NOT_ENCRYPTED.
    await expect(decryptPDF(await makePdf(["plain"]), "x")).rejects.toThrow(
      /not encrypted/i,
    );
  });
});
