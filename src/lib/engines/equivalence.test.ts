// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ConversionType } from "@/lib/engines/types";
import type {
  ProcessingInputFile,
  ProcessingRequest,
  ToolProcessor,
} from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { DEFAULT_PROCESSING_LIMITS } from "@/lib/processing/limits";
import { getProcessor } from "@/lib/processing/registry";
import { runProcessingJob } from "@/lib/processing/service";
import { compareDocumentsProcessor } from "@/lib/processing/processors/compare-documents";
import { compressPdfProcessor } from "@/lib/processing/processors/compress-pdf";
import { extractImagesProcessor } from "@/lib/processing/processors/extract-images";
import { extractTablesProcessor } from "@/lib/processing/processors/extract-tables";
import {
  imagesToPdfProcessor,
  pngToPdfProcessor,
} from "@/lib/processing/processors/images-to-pdf";
import { pdfToExcelProcessor } from "@/lib/processing/processors/pdf-to-excel";
import {
  pdfToJpgProcessor,
  pdfToPngProcessor,
} from "@/lib/processing/processors/pdf-to-image";
import { pdfToTextProcessor } from "@/lib/processing/processors/pdf-to-text";
import { pdfToWordProcessor } from "@/lib/processing/processors/pdf-to-word";
import {
  makeBrokenPdf,
  makeJpeg,
  makeNonImage,
  makeNonPdf,
  makePdf,
  makePng,
  makeScannedPdf,
  makeUncompressedPdf,
} from "@/test/pdf-fixtures";

/**
 * Stage 1 equivalence proof (Phase 67).
 *
 * For every migrated conversion, the OLD path (the direct processor, exactly
 * as it ran before) and the NEW live path (processing registry → engine
 * processor → router → current engine adapter → the same processor) must
 * behave identically: same success shape, same meta (apart from the two
 * additive engine keys), same bytes where the format is deterministic, and
 * the same typed failure for the same bad input.
 */

const CONTEXT = { limits: DEFAULT_PROCESSING_LIMITS };

interface EquivalenceCase {
  conversionType: ConversionType;
  engineId: string;
  direct: ToolProcessor<Record<string, unknown>>;
  makeFiles: () => Promise<ProcessingInputFile[]>;
  options?: Record<string, unknown>;
  failureFiles: () => Promise<ProcessingInputFile[]>;
  /**
   * True when the output bytes are fully deterministic (no embedded
   * timestamps). DOCX/XLSX/PDF outputs stamp creation dates, so only their
   * structure and meta are compared.
   */
  byteStable: boolean;
}

async function pdfFile(
  id: string,
  bytes: Uint8Array,
): Promise<ProcessingInputFile> {
  return {
    id,
    name: `${id}.pdf`,
    size: bytes.length,
    mimeType: "application/pdf",
    bytes,
  };
}

async function imageFile(
  id: string,
  bytes: Uint8Array,
  mimeType: string,
  extension: string,
): Promise<ProcessingInputFile> {
  return {
    id,
    name: `${id}${extension}`,
    size: bytes.length,
    mimeType,
    bytes,
  };
}

const CASES: EquivalenceCase[] = [
  {
    conversionType: "pdf-to-word",
    engineId: "current-pdfium-docx",
    direct: pdfToWordProcessor,
    makeFiles: async () => [
      await pdfFile("sample", await makePdf(["Hello World", "Second Page"])),
    ],
    failureFiles: async () => [await pdfFile("broken", makeNonPdf())],
    byteStable: false, // DOCX embeds creation dates
  },
  {
    conversionType: "pdf-to-excel",
    engineId: "current-pdfium-exceljs",
    direct: pdfToExcelProcessor,
    makeFiles: async () => [
      await pdfFile("sample", await makePdf(["Alpha  Beta", "Gamma   Delta"])),
    ],
    failureFiles: async () => [await pdfFile("broken", makeNonPdf())],
    byteStable: false, // XLSX embeds workbook creation dates
  },
  {
    conversionType: "pdf-to-text",
    engineId: "current-pdfium-text",
    direct: pdfToTextProcessor,
    options: { pages: "all" },
    makeFiles: async () => [
      await pdfFile("sample", await makePdf(["Some extractable text"])),
    ],
    failureFiles: async () => [await pdfFile("broken", makeNonPdf())],
    byteStable: true,
  },
  {
    conversionType: "pdf-to-jpg",
    engineId: "current-pdfium-jpeg",
    direct: pdfToJpgProcessor,
    makeFiles: async () => [await pdfFile("sample", await makePdf(["A"]))],
    failureFiles: async () => [await pdfFile("broken", makeNonPdf())],
    byteStable: true,
  },
  {
    conversionType: "pdf-to-png",
    engineId: "current-pdfium-png",
    direct: pdfToPngProcessor,
    makeFiles: async () => [await pdfFile("sample", await makePdf(["A"]))],
    failureFiles: async () => [await pdfFile("broken", makeNonPdf())],
    byteStable: true,
  },
  {
    conversionType: "extract-images",
    engineId: "current-pdf-lib-extract-images",
    direct: extractImagesProcessor,
    options: { pages: "all" },
    makeFiles: async () => [
      await pdfFile("scanned", await makeScannedPdf(1)),
    ],
    failureFiles: async () => [await pdfFile("broken", makeNonPdf())],
    byteStable: true,
  },
  {
    conversionType: "extract-tables",
    engineId: "current-pdfium-tables",
    direct: extractTablesProcessor,
    options: { format: "csv" },
    makeFiles: async () => [
      await pdfFile("sample", await makePdf(["Alpha  Beta   Gamma"])),
    ],
    failureFiles: async () => [await pdfFile("broken", makeNonPdf())],
    byteStable: true, // CSV output carries no timestamps
  },
  {
    conversionType: "images-to-pdf",
    engineId: "current-pdf-lib-images",
    direct: imagesToPdfProcessor,
    makeFiles: async () => [
      await imageFile("photo", await makeJpeg(12, 9), "image/jpeg", ".jpg"),
      await imageFile("icon", await makePng(8, 8), "image/png", ".png"),
    ],
    failureFiles: async () => [
      await imageFile("broken", makeNonImage(), "image/jpeg", ".jpg"),
    ],
    byteStable: false, // PDF metadata stamps creation dates
  },
  {
    conversionType: "png-to-pdf",
    engineId: "current-pdf-lib-png",
    direct: pngToPdfProcessor,
    makeFiles: async () => [
      await imageFile("icon", await makePng(8, 8), "image/png", ".png"),
    ],
    failureFiles: async () => [
      // A JPEG wearing a .png name: the tool must reject it by content.
      await imageFile("sneaky", await makeJpeg(8, 8), "image/png", ".png"),
    ],
    byteStable: false,
  },
  {
    conversionType: "compress-pdf",
    engineId: "current-pdf-lib-compress",
    direct: compressPdfProcessor,
    makeFiles: async () => [await pdfFile("bloated", makeUncompressedPdf(2))],
    failureFiles: async () => [await pdfFile("broken", makeNonPdf())],
    byteStable: false,
  },
  {
    conversionType: "compare-documents",
    engineId: "current-pdfium-compare",
    direct: compareDocumentsProcessor,
    makeFiles: async () => [
      await pdfFile("doc-a", await makePdf(["Version A"])),
      await pdfFile("doc-b", await makePdf(["Version B"])),
    ],
    failureFiles: async () => [
      await pdfFile("doc-a", await makePdf(["Version A"])),
      await pdfFile("broken", makeNonPdf()),
    ],
    byteStable: true, // the report text carries no timestamps (verified)
  },
];

function makeRequest(
  conversionType: ConversionType,
  files: ProcessingInputFile[],
  options?: Record<string, unknown>,
): ProcessingRequest<Record<string, unknown>> {
  return { toolId: conversionType, files, options };
}

describe("Stage 1 equivalence: direct processor vs router → current engine", () => {
  for (const testCase of CASES) {
    describe(testCase.conversionType, () => {
      it("replaces the direct processor in the live registry, keeping id and input rules", () => {
        const live = getProcessor<Record<string, unknown>>(
          testCase.conversionType,
        );
        // The registry now serves the engine-backed processor…
        expect(live).not.toBe(testCase.direct);
        // …with the same tool id and the very same input rules object,
        // borrowed through the adapter — so validation is identical.
        expect(live.toolId).toBe(testCase.direct.toolId);
        expect(live.input).toBe(testCase.direct.input);
      });

      it("produces equivalent success output through the live engine path", async () => {
        const oldResult = await testCase.direct.process(
          makeRequest(testCase.conversionType, await testCase.makeFiles(), testCase.options),
          CONTEXT,
        );
        const live = getProcessor<Record<string, unknown>>(
          testCase.conversionType,
        );
        const newResult = await live.process(
          makeRequest(testCase.conversionType, await testCase.makeFiles(), testCase.options),
          CONTEXT,
        );

        expect(oldResult.status).toBe("succeeded");
        expect(newResult.status).toBe("succeeded");
        if (oldResult.status !== "succeeded" || newResult.status !== "succeeded") {
          return;
        }

        // Same artifact shape…
        expect(newResult.artifacts.map((a) => a.name)).toEqual(
          oldResult.artifacts.map((a) => a.name),
        );
        expect(newResult.artifacts.map((a) => a.mimeType)).toEqual(
          oldResult.artifacts.map((a) => a.mimeType),
        );
        expect(newResult.bundleName).toBe(oldResult.bundleName);
        for (const artifact of newResult.artifacts) {
          expect(artifact.size).toBeGreaterThan(0);
        }

        // …same bytes where the output format is deterministic…
        if (testCase.byteStable) {
          expect(
            newResult.artifacts.map((a) => Buffer.from(a.bytes).toString("base64")),
          ).toEqual(
            oldResult.artifacts.map((a) => Buffer.from(a.bytes).toString("base64")),
          );
        }

        // …and the same meta apart from the two additive engine keys.
        const { engineId, attempt, ...restMeta } = newResult.meta ?? {};
        expect(restMeta).toEqual(oldResult.meta ?? {});
        expect(engineId).toBe(testCase.engineId);
        expect(attempt).toBe(1);
      });

      it("fails identically through the live engine path", async () => {
        const live = getProcessor<Record<string, unknown>>(
          testCase.conversionType,
        );
        const [oldOutcome, newOutcome] = await Promise.allSettled([
          testCase.direct.process(
            makeRequest(testCase.conversionType, await testCase.failureFiles(), testCase.options),
            CONTEXT,
          ),
          live.process(
            makeRequest(testCase.conversionType, await testCase.failureFiles(), testCase.options),
            CONTEXT,
          ),
        ]);

        expect(oldOutcome.status).toBe("rejected");
        expect(newOutcome.status).toBe("rejected");
        if (oldOutcome.status !== "rejected" || newOutcome.status !== "rejected") {
          return;
        }
        const oldError = oldOutcome.reason;
        const newError = newOutcome.reason;

        expect(newError.constructor.name).toBe(oldError.constructor.name);
        expect(newError instanceof ProcessingError).toBe(
          oldError instanceof ProcessingError,
        );
        if (oldError instanceof ProcessingError && newError instanceof ProcessingError) {
          expect(newError.code).toBe(oldError.code);
          expect(newError.status).toBe(oldError.status);
          expect(newError.details).toEqual(oldError.details);
        }
        expect(newError.message).toBe(oldError.message);
      });
    });
  }
});

describe("Stage 1 equivalence: live service path (runProcessingJob)", () => {
  it("routes a conversion through the engine layer end to end", async () => {
    const result = await runProcessingJob({
      toolId: "pdf-to-word",
      files: [await pdfFile("service", await makePdf(["Service level"]))],
    });

    expect(result.status).toBe("succeeded");
    if (result.status === "succeeded") {
      expect(result.meta?.engineId).toBe("current-pdfium-docx");
      expect(result.meta?.attempt).toBe(1);
      expect(result.meta?.mode).toBe("text-only");
      expect(result.meta?.pages).toBe(1);
      expect(result.artifacts[0].name).toBe("service.docx");
    }
  });

  it("returns the same structured failure for a broken document", async () => {
    const result = await runProcessingJob({
      toolId: "pdf-to-word",
      files: [await pdfFile("broken", makeBrokenPdf())],
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.code).toBe("INVALID_PDF");
    }
  });
});

describe("Stage 2 additions are invisible in the processing result (Phase 68)", () => {
  it("meta is EXACTLY the processor meta plus engineId and attempt — nothing else", async () => {
    const files = async () => [
      await pdfFile("sample", await makePdf(["Equivalence text"])),
    ];
    const options = { pages: "all" };

    const directWord = await pdfToWordProcessor.process(
      makeRequest("pdf-to-word", await files()),
      CONTEXT,
    );
    const liveWord = await getProcessor<Record<string, unknown>>("pdf-to-word").process(
      makeRequest("pdf-to-word", await files()),
      CONTEXT,
    );
    expect(liveWord.meta).toEqual({
      ...(directWord.meta ?? {}),
      engineId: "current-pdfium-docx",
      attempt: 1,
    });

    const directText = await pdfToTextProcessor.process(
      makeRequest("pdf-to-text", await files(), options),
      CONTEXT,
    );
    const liveText = await getProcessor<Record<string, unknown>>("pdf-to-text").process(
      makeRequest("pdf-to-text", await files(), options),
      CONTEXT,
    );
    expect(liveText.meta).toEqual({
      ...(directText.meta ?? {}),
      engineId: "current-pdfium-text",
      attempt: 1,
    });

    // Deterministic-format output is still byte-identical through the
    // engine path (profile + validation changed nothing about it).
    if (directText.status === "succeeded" && liveText.status === "succeeded") {
      expect(Buffer.from(liveText.artifacts[0].bytes).toString("base64")).toBe(
        Buffer.from(directText.artifacts[0].bytes).toString("base64"),
      );
    }
  });

  it("multi-artifact conversions validate every artifact without changing output", async () => {
    const files = async () => [
      await pdfFile("multi", await makePdf(["Page one", "Page two"])),
    ];

    const direct = await pdfToJpgProcessor.process(
      makeRequest("pdf-to-jpg", await files()),
      CONTEXT,
    );
    const live = await getProcessor<Record<string, unknown>>("pdf-to-jpg").process(
      makeRequest("pdf-to-jpg", await files()),
      CONTEXT,
    );

    expect(direct.status).toBe("succeeded");
    expect(live.status).toBe("succeeded");
    if (direct.status !== "succeeded" || live.status !== "succeeded") return;

    expect(live.artifacts).toHaveLength(direct.artifacts.length);
    expect(live.bundleName).toBe(direct.bundleName);
    expect(
      live.artifacts.map((artifact) => Buffer.from(artifact.bytes).toString("base64")),
    ).toEqual(
      direct.artifacts.map((artifact) => Buffer.from(artifact.bytes).toString("base64")),
    );
    const { engineId, attempt, ...restMeta } = live.meta ?? {};
    expect(restMeta).toEqual(direct.meta ?? {});
    expect(engineId).toBe("current-pdfium-jpeg");
    expect(attempt).toBe(1);
  });
});
