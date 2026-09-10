// @vitest-environment node
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  detectOutputClass,
  readZipEntryNames,
  validateArtifact,
  validateEngineResult,
  type ArtifactValidation,
  type OutputCheckId,
} from "@/lib/engines/validation";
import type { EngineResult, OutputValidationState } from "@/lib/engines/types";
import type { ProcessingArtifact } from "@/lib/processing/contract";
import { DEFAULT_PROCESSING_LIMITS } from "@/lib/processing/limits";
import { pdfToExcelProcessor } from "@/lib/processing/processors/pdf-to-excel";
import { pdfToWordProcessor } from "@/lib/processing/processors/pdf-to-word";
import {
  makeBrokenPdf,
  makeJpeg,
  makeNonPdf,
  makePdf,
  makePng,
} from "@/test/pdf-fixtures";

const CONTEXT = { limits: DEFAULT_PROCESSING_LIMITS };

function artifact(
  bytes: Uint8Array,
  mimeType: string,
  name = "out.bin",
): ProcessingArtifact {
  return { name, mimeType, size: bytes.length, bytes };
}

async function pdfFile(bytes: Uint8Array) {
  return {
    id: "f1",
    name: "doc.pdf",
    size: bytes.length,
    mimeType: "application/pdf",
    bytes,
  };
}

/** Real, engine-produced artifacts (the honest test subjects). */
async function realDocxArtifact(): Promise<ProcessingArtifact> {
  const success = await pdfToWordProcessor.process(
    { toolId: "pdf-to-word", files: [await pdfFile(await makePdf(["Hello"]))] },
    CONTEXT,
  );
  return success.artifacts[0];
}

async function realXlsxArtifact(): Promise<ProcessingArtifact> {
  const success = await pdfToExcelProcessor.process(
    { toolId: "pdf-to-excel", files: [await pdfFile(await makePdf(["a  b"]))] },
    CONTEXT,
  );
  return success.artifacts[0];
}

function engineResult(artifacts: ProcessingArtifact[]): EngineResult {
  return {
    artifacts,
    engineId: "test-engine",
    attempt: 1,
    durationMs: 0,
    warnings: [],
    validation: { status: "not-evaluated" },
  };
}

function checkIds(
  validation: OutputValidationState | ArtifactValidation,
): readonly OutputCheckId[] {
  return ("checks" in validation ? validation.checks ?? [] : []) as readonly OutputCheckId[];
}

describe("OutputValidator — class detection", () => {
  it("classifies artifacts by their server-generated MIME type", () => {
    expect(detectOutputClass(artifact(new Uint8Array(4), "application/pdf"))).toBe("pdf");
    expect(
      detectOutputClass(
        artifact(
          new Uint8Array(4),
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
      ),
    ).toBe("docx");
    expect(
      detectOutputClass(
        artifact(
          new Uint8Array(4),
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ),
      ),
    ).toBe("xlsx");
    expect(detectOutputClass(artifact(new Uint8Array(4), "application/zip"))).toBe("zip");
    expect(detectOutputClass(artifact(new Uint8Array(4), "image/png"))).toBe("png");
    expect(detectOutputClass(artifact(new Uint8Array(4), "image/jpeg"))).toBe("jpeg");
    expect(detectOutputClass(artifact(new Uint8Array(4), "text/plain; charset=utf-8"))).toBe("text");
    expect(detectOutputClass(artifact(new Uint8Array(4), "text/csv; charset=utf-8"))).toBe("text");
    expect(detectOutputClass(artifact(new Uint8Array(4), "application/x-custom"))).toBe("unknown");
  });
});

describe("OutputValidator — PDF artifacts", () => {
  it("accepts a generated PDF", async () => {
    const result = validateArtifact(artifact(await makePdf(["A"]), "application/pdf", "out.pdf"));
    expect(result.valid).toBe(true);
    expect(result.indeterminate).toBe(false);
    expect(checkIds(result)).toContain("pdf-signature");
    expect(checkIds(result)).toContain("pdf-eof");
  });

  it("rejects bytes without a PDF trailer", () => {
    // Header present (makeBrokenPdf starts with %PDF-) but no %%EOF.
    const result = validateArtifact(artifact(makeBrokenPdf(), "application/pdf", "out.pdf"));
    expect(result.valid).toBe(false);
  });

  it("rejects non-PDF bytes claiming to be a PDF", () => {
    const result = validateArtifact(artifact(makeNonPdf(), "application/pdf", "out.pdf"));
    expect(result.valid).toBe(false);
    expect(checkIds(result)).toContain("pdf-signature");
  });
});

describe("OutputValidator — DOCX artifacts", () => {
  it("accepts a real DOCX produced by the pdf-to-word processor", async () => {
    const docx = await realDocxArtifact();
    const result = validateArtifact(docx);
    expect(result.valid).toBe(true);
    expect(checkIds(result)).toContain("zip-container");
    expect(checkIds(result)).toContain("zip-required-parts");
  });

  it("rejects a non-ZIP payload with a DOCX MIME type", () => {
    const result = validateArtifact(
      artifact(new TextEncoder().encode("not a zip at all"), docxMime(), "out.docx"),
    );
    expect(result.valid).toBe(false);
    expect(checkIds(result)).toContain("zip-container");
  });

  it("rejects a ZIP missing the required Office parts", () => {
    const bytes = zipSync({ "[Content_Types].xml": strToU8("<Types/>") });
    const result = validateArtifact(artifact(bytes, docxMime(), "out.docx"));
    expect(result.valid).toBe(false);
    expect(checkIds(result)).toContain("zip-required-parts");
  });

  it("mirrors the pdf-to-word processor's own required-parts rule", async () => {
    // The processor's validateDocx requires exactly these two entries; the
    // generalized validator must agree on both the accept and reject side.
    const docx = await realDocxArtifact();
    const names = readZipEntryNames(docx.bytes);
    expect(names).toBeDefined();
    expect(names).toContain("[Content_Types].xml");
    expect(names).toContain("word/document.xml");

    const withoutDocumentXml = zipSync({
      "[Content_Types].xml": strToU8("<Types/>"),
      "word/styles.xml": strToU8("<styles/>"),
    });
    expect(
      validateArtifact(artifact(withoutDocumentXml, docxMime(), "out.docx")).valid,
    ).toBe(false);
  });
});

describe("OutputValidator — XLSX artifacts", () => {
  it("accepts a real XLSX produced by the pdf-to-excel processor", async () => {
    const xlsx = await realXlsxArtifact();
    const result = validateArtifact(xlsx);
    expect(result.valid).toBe(true);
    expect(checkIds(result)).toContain("zip-container");
    expect(checkIds(result)).toContain("zip-required-parts");
  });

  it("rejects a malformed container", () => {
    const result = validateArtifact(
      artifact(new Uint8Array([1, 2, 3]), xlsxMime(), "out.xlsx"),
    );
    expect(result.valid).toBe(false);
  });

  it("rejects a workbook without xl/workbook.xml", () => {
    const bytes = zipSync({ "[Content_Types].xml": strToU8("<Types/>") });
    expect(validateArtifact(artifact(bytes, xlsxMime(), "out.xlsx")).valid).toBe(false);
  });
});

describe("OutputValidator — PNG artifacts", () => {
  it("accepts a real PNG", async () => {
    const result = validateArtifact(artifact(await makePng(8, 8), "image/png", "out.png"));
    expect(result.valid).toBe(true);
    expect(checkIds(result)).toContain("png-signature");
    expect(checkIds(result)).toContain("png-chunk-structure");
  });

  it("rejects a corrupted signature", async () => {
    const bytes = await makePng(8, 8);
    bytes[0] = 0x00;
    expect(validateArtifact(artifact(bytes, "image/png", "out.png")).valid).toBe(false);
  });

  it("rejects a truncated PNG (IEND missing)", async () => {
    const bytes = await makePng(8, 8);
    const truncated = bytes.subarray(0, bytes.length - 20);
    expect(validateArtifact(artifact(truncated, "image/png", "out.png")).valid).toBe(false);
  });
});

describe("OutputValidator — JPEG artifacts", () => {
  it("accepts a real JPEG", async () => {
    const result = validateArtifact(artifact(await makeJpeg(8, 8), "image/jpeg", "out.jpg"));
    expect(result.valid).toBe(true);
    expect(checkIds(result)).toContain("jpeg-signature");
    expect(checkIds(result)).toContain("jpeg-eoi");
  });

  it("rejects clearly malformed bytes", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 1, 2, 3]);
    expect(validateArtifact(artifact(bytes, "image/jpeg", "out.jpg")).valid).toBe(false);
  });

  it("rejects a JPEG without the EOI marker at the end", async () => {
    const bytes = await makeJpeg(8, 8);
    const noEoi = bytes.subarray(0, bytes.length - 1);
    expect(validateArtifact(artifact(noEoi, "image/jpeg", "out.jpg")).valid).toBe(false);
  });
});

describe("OutputValidator — text artifacts", () => {
  it("accepts non-empty text output", () => {
    const result = validateArtifact(
      artifact(new TextEncoder().encode("--- Page 1 ---\nHello"), "text/plain; charset=utf-8", "out.txt"),
    );
    expect(result.valid).toBe(true);
    expect(checkIds(result)).toContain("text-non-empty");
  });

  it("flags empty text output as structurally invalid (diagnostic)", () => {
    const result = validateArtifact(artifact(new Uint8Array(0), "text/plain; charset=utf-8", "out.txt"));
    expect(result.valid).toBe(false);
  });
});

describe("OutputValidator — ZIP artifacts", () => {
  it("validates the container and its entries", () => {
    const bytes = zipSync({ "a.txt": strToU8("a"), "b.txt": strToU8("b") });
    const result = validateArtifact(artifact(bytes, "application/zip", "out.zip"));
    expect(result.valid).toBe(true);
    expect(checkIds(result)).toContain("zip-container");
    expect(readZipEntryNames(bytes)).toEqual(["a.txt", "b.txt"]);
  });

  it("rejects a broken container", () => {
    expect(
      validateArtifact(artifact(new TextEncoder().encode("PK.."), "application/zip", "out.zip")).valid,
    ).toBe(false);
  });
});

describe("OutputValidator — basic and unknown-class checks", () => {
  it("reports unknown output classes as not-evaluated, not passed", () => {
    const result = validateArtifact(
      artifact(new TextEncoder().encode("x"), "application/x-custom", "out.bin"),
    );
    expect(result.valid).toBe(true);
    expect(result.indeterminate).toBe(true);
  });

  it("rejects empty artifacts and unsafe names whatever the class", () => {
    expect(
      validateArtifact(artifact(new Uint8Array(0), "application/x-custom", "out.bin")).valid,
    ).toBe(false);
    expect(
      validateArtifact(artifact(new Uint8Array(1), "application/pdf", "")).valid,
    ).toBe(false);
    expect(
      validateArtifact(artifact(new Uint8Array(1), "application/pdf", "a/b.pdf")).valid,
    ).toBe(false);
    expect(
      validateArtifact(artifact(new Uint8Array(1), "application/pdf", "a\u0000b.pdf")).valid,
    ).toBe(false);
  });
});

describe("OutputValidator — engine result integration (diagnostic only)", () => {
  it("fails an empty artifact list structurally", () => {
    const validated = validateEngineResult(engineResult([]));
    expect(validated.validation).toEqual({
      status: "failed",
      checks: ["output-count-valid"],
    });
  });

  it("marks an all-valid outcome as passed with the performed checks", async () => {
    const validated = validateEngineResult(
      engineResult([artifact(await makePdf(["A"]), "application/pdf", "a.pdf")]),
    );
    expect(validated.validation.status).toBe("passed");
    expect(checkIds(validated.validation)).toContain("output-count-valid");
    expect(checkIds(validated.validation)).toContain("pdf-signature");
  });

  it("marks the whole outcome failed when one artifact fails", async () => {
    const validated = validateEngineResult(
      engineResult([
        artifact(await makePdf(["A"]), "application/pdf", "a.pdf"),
        artifact(makeBrokenPdf(), "application/pdf", "b.pdf"),
      ]),
    );
    expect(validated.validation.status).toBe("failed");
    // The valid artifact's checks are still recorded alongside the failure.
    expect(checkIds(validated.validation)).toContain("pdf-eof");
  });

  it("reports not-evaluated when only unknown-class artifacts exist", () => {
    const validated = validateEngineResult(
      engineResult([artifact(new Uint8Array(1), "application/x-custom", "a.bin")]),
    );
    expect(validated.validation).toEqual({ status: "not-evaluated" });
  });

  it("NEVER mutates or drops the artifacts — a failed verdict is recorded, not enforced", async () => {
    const broken = artifact(makeBrokenPdf(), "application/pdf", "broken.pdf");
    const original = engineResult([broken]);
    const validated = validateEngineResult(original);

    // The original result is untouched (immutability)…
    expect(original.validation).toEqual({ status: "not-evaluated" });
    expect(original.artifacts).toHaveLength(1);
    // …and the validated result still carries the artifacts unchanged.
    expect(validated.artifacts).toBe(original.artifacts);
    expect(validated.artifacts[0]).toBe(broken);
    expect(validated.validation.status).toBe("failed");
  });
});

function docxMime(): string {
  return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}
function xlsxMime(): string {
  return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}
