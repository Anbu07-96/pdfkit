// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  assessConversionQuality,
  QUALITY_VERSION,
  type QualityAssessmentInput,
} from "@/lib/engines/quality";
import { CURRENT_ENGINES } from "@/lib/engines/adapters/current";
import type { ConversionType } from "@/lib/engines/types";
import { DEFAULT_PROCESSING_LIMITS } from "@/lib/processing/limits";
import { runProcessingJob } from "@/lib/processing/service";
import {
  makeJpeg,
  makePdf,
  makePng,
  makeScannedPdf,
} from "@/test/pdf-fixtures";

const CONTEXT = { limits: DEFAULT_PROCESSING_LIMITS };

/** A baseline input where every common check passes. */
function baseInput(overrides: Partial<QualityAssessmentInput> = {}): QualityAssessmentInput {
  return {
    validation: { status: "passed", checks: ["non-empty", "artifact-name-valid"] },
    meta: {},
    artifactCount: 1,
    outputBytes: 2048,
    inputFileCount: 1,
    ...overrides,
  };
}

async function runEngine(
  engineId: string,
  files: { name: string; mimeType: string; bytes: Uint8Array }[],
  options?: Record<string, unknown>,
) {
  const engine = CURRENT_ENGINES.find((e) => e.descriptor.id === engineId);
  if (!engine) throw new Error(`engine ${engineId} missing`);
  return engine.run(
    {
      toolId: engine.descriptor.toolId,
      files: files.map((file, index) => ({
        id: `f${index + 1}`,
        name: file.name,
        size: file.bytes.length,
        mimeType: file.mimeType,
        bytes: file.bytes,
      })),
      ...(options ? { options } : {}),
    },
    CONTEXT,
  );
}

async function pdfBytes(labels: string[]): Promise<Uint8Array> {
  return makePdf(labels);
}

function ids(assessment: { checks: readonly { id: string }[] }): string[] {
  return assessment.checks.map((check) => check.id);
}

describe("QualityGate — policy basics", () => {
  it("reports healthy when all evaluated checks pass, with score 100", () => {
    const assessment = assessConversionQuality("pdf-to-word", baseInput({
      meta: { characters: 1200, pages: 3 },
    }));
    expect(assessment.state).toBe("healthy");
    expect(assessment.score).toBe(100);
    expect(assessment.qualityVersion).toBe(QUALITY_VERSION);
    expect(assessment.qualityVersion).toBe(1);
  });

  it("reports suspicious when a measurable signal warns — without failing anything", () => {
    const assessment = assessConversionQuality("pdf-to-word", baseInput({
      meta: { characters: 0, pages: 3 },
    }));
    expect(assessment.state).toBe("suspicious");
    expect(assessment.score).toBeLessThan(100);
    const volume = assessment.checks.find((c) => c.id === "output-content-volume");
    expect(volume?.state).toBe("warn");
  });

  it("reports insufficient when less than half the measurable evidence exists", () => {
    const assessment = assessConversionQuality("pdf-to-word", baseInput({
      validation: { status: "not-evaluated" },
      meta: {},
    }));
    // Only output-count is evaluable: 2 of 9 measurable weight.
    expect(assessment.state).toBe("insufficient");
  });

  it("reports not-evaluated for a conversion type without a policy", () => {
    const assessment = assessConversionQuality(
      "definitely-not-a-conversion" as ConversionType,
      baseInput(),
    );
    expect(assessment).toEqual({
      qualityVersion: QUALITY_VERSION,
      state: "not-evaluated",
      score: 0,
      checks: [],
    });
  });

  it("keeps the score within 0–100 at the boundaries", () => {
    const allWarn = assessConversionQuality("pdf-to-word", baseInput({
      validation: { status: "failed", checks: ["pdf-signature"] },
      artifactCount: 0,
      outputBytes: 0,
      meta: { characters: 0 },
    }));
    expect(allWarn.score).toBe(0);
    expect(allWarn.state).toBe("suspicious");

    const allPass = assessConversionQuality("pdf-to-word", baseInput({
      meta: { characters: 500 },
    }));
    expect(allPass.score).toBe(100);
  });

  it("is deterministic: identical inputs yield identical assessments", () => {
    const input = baseInput({ meta: { characters: 42, pages: 2 } });
    const first = assessConversionQuality("pdf-to-word", input);
    const second = assessConversionQuality("pdf-to-word", input);
    expect(first).toEqual(second);
  });

  it("uses the full profile's text signals when one is genuinely available", () => {
    const assessment = assessConversionQuality("pdf-to-word", baseInput({
      profile: {
        profileVersion: 1,
        documentKind: "pdf",
        fileSizeBytes: 1000,
        inputMimeType: "application/pdf",
        analysisState: "complete",
        pageCount: 4,
        textPageCount: 0,
        emptyTextPageCount: 4,
        textCharacterCount: 0,
        textYieldRatio: 0,
        imageObjectCount: 4,
        imageBearingPageCount: 4,
        likelyScannedPageCount: 4,
        likelyScannedRatio: 1,
      },
      meta: { characters: 0, pages: 4 },
    }));
    expect(assessment.state).toBe("suspicious");
    const source = assessment.checks.find((c) => c.id === "source-text-availability");
    expect(source?.state).toBe("warn");
    expect(source?.reason).toContain("no extractable text");
  });
});

describe("QualityGate — PDF → Word", () => {
  it("rates a real text-bearing conversion healthy", async () => {
    const result = await runEngine("current-pdfium-docx", [
      { name: "doc.pdf", mimeType: "application/pdf", bytes: await pdfBytes(["Hello quality", "Second page"]) },
    ]);

    expect(result.artifacts.length).toBeGreaterThan(0);
    expect(result.quality?.state).toBe("healthy");
    expect(result.quality?.score).toBe(100);
    expect(ids(result.quality!)).toContain("output-structurally-valid");
    expect(ids(result.quality!)).toContain("output-content-volume");
  });

  it("rates a scanned input suspicious but STILL SUCCEEDS (no rejection)", async () => {
    const result = await runEngine("current-pdfium-docx", [
      { name: "scan.pdf", mimeType: "application/pdf", bytes: await makeScannedPdf(2) },
    ]);

    // The conversion is successful — the gate only diagnoses.
    expect(result.artifacts.length).toBeGreaterThan(0);
    expect(result.artifacts).toHaveLength(1);
    expect(result.quality?.state).toBe("suspicious");
    const volume = result.quality?.checks.find((c) => c.id === "output-content-volume");
    expect(volume?.state).toBe("warn");
    // The live path has only the signature tier: availability is honestly
    // unknown, not guessed.
    const source = result.quality?.checks.find((c) => c.id === "source-text-availability");
    expect(source?.state).toBe("not-evaluated");
  });
});

describe("QualityGate — PDF → Text", () => {
  it("rates a text-rich input healthy", async () => {
    const result = await runEngine(
      "current-pdfium-text",
      [{ name: "doc.pdf", mimeType: "application/pdf", bytes: await pdfBytes(["Plenty of real text here"]) }],
      { pages: "all" },
    );

    expect(result.artifacts.length).toBeGreaterThan(0);
    expect(result.quality?.state).toBe("healthy");
  });

  it("flags a marker-only output (scanned input) as suspicious — diagnostic only", async () => {
    const result = await runEngine(
      "current-pdfium-text",
      [{ name: "scan.pdf", mimeType: "application/pdf", bytes: await makeScannedPdf(2) }],
      { pages: "all" },
    );

    expect(result.artifacts.length).toBeGreaterThan(0);
    expect(result.quality?.state).toBe("suspicious");
    const volume = result.quality?.checks.find((c) => c.id === "output-content-volume");
    expect(volume?.state).toBe("warn");
    expect(volume?.reason).toContain("page markers");
  });

  it("warns on an empty text output", () => {
    const assessment = assessConversionQuality("pdf-to-text", baseInput({
      outputBytes: 0,
      outputTextMarkerOnly: false,
    }));
    const volume = assessment.checks.find((c) => c.id === "output-content-volume");
    expect(volume?.state).toBe("warn");
    expect(assessment.state).toBe("suspicious");
  });

  it("uses source text volume when a full profile is available", () => {
    const assessment = assessConversionQuality("pdf-to-text", baseInput({
      outputBytes: 100,
      outputTextMarkerOnly: false,
      profile: {
        profileVersion: 1,
        documentKind: "pdf",
        fileSizeBytes: 9000,
        inputMimeType: "application/pdf",
        analysisState: "complete",
        pageCount: 1,
        textPageCount: 1,
        textCharacterCount: 8000,
        textYieldRatio: 1,
      },
    }));
    const volume = assessment.checks.find((c) => c.id === "output-content-volume");
    expect(volume?.state).toBe("warn");
    expect(volume?.reason).toContain("far smaller");
  });
});

describe("QualityGate — PDF → Excel (conservative)", () => {
  it("rates a text/table input with rows as healthy", async () => {
    const result = await runEngine("current-pdfium-exceljs", [
      { name: "t.pdf", mimeType: "application/pdf", bytes: await pdfBytes(["Alpha  Beta   Gamma", "One  Two   Three"]) },
    ]);

    expect(result.artifacts.length).toBeGreaterThan(0);
    expect(result.quality?.state).toBe("healthy");
    const volume = result.quality?.checks.find((c) => c.id === "table-content-volume");
    expect(volume?.state).toBe("pass");
  });

  it("treats an image-only source conservatively: a low-weight diagnostic, never a failure", async () => {
    const result = await runEngine("current-pdfium-exceljs", [
      { name: "scan.pdf", mimeType: "application/pdf", bytes: await makeScannedPdf(1) },
    ]);

    expect(result.artifacts.length).toBeGreaterThan(0);
    expect(result.quality?.state).toBe("suspicious");
    const volume = result.quality?.checks.find((c) => c.id === "table-content-volume");
    expect(volume?.state).toBe("warn");
    expect(volume?.weight).toBe(1);
    expect(volume?.reason).toContain("may not contain tables");
  });

  it("does not treat zero rows as suspicious when the source provably has no text", () => {
    const assessment = assessConversionQuality("pdf-to-excel", baseInput({
      meta: { rowsExtracted: 0 },
      profile: {
        profileVersion: 1,
        documentKind: "pdf",
        fileSizeBytes: 500,
        inputMimeType: "application/pdf",
        analysisState: "complete",
        pageCount: 1,
        textPageCount: 0,
        textYieldRatio: 0,
      },
    }));
    const volume = assessment.checks.find((c) => c.id === "table-content-volume");
    expect(volume?.state).toBe("not-evaluated");
    expect(assessment.state).toBe("healthy");
  });
});

describe("QualityGate — image conversions ignore text signals", () => {
  it("does not penalize PDF → JPG for a text-free (scanned) source", async () => {
    const result = await runEngine("current-pdfium-jpeg", [
      { name: "scan.pdf", mimeType: "application/pdf", bytes: await makeScannedPdf(2) },
    ]);

    expect(result.artifacts.length).toBeGreaterThan(0);
    expect(result.quality?.state).toBe("healthy");
    // No text checks exist for raster conversions at all.
    expect(ids(result.quality!)).not.toContain("source-text-availability");
    expect(ids(result.quality!)).not.toContain("output-content-volume");
    expect(ids(result.quality!)).toContain("output-page-coverage");
  });

  it("does not penalize PDF → PNG for a text-free source", async () => {
    const result = await runEngine("current-pdfium-png", [
      { name: "scan.pdf", mimeType: "application/pdf", bytes: await makeScannedPdf(1) },
    ]);
    expect(result.quality?.state).toBe("healthy");
  });

  it("warns when page coverage mismatches", () => {
    const assessment = assessConversionQuality("pdf-to-jpg", baseInput({
      meta: { images: 2, pages: 5 },
    }));
    const coverage = assessment.checks.find((c) => c.id === "output-page-coverage");
    expect(coverage?.state).toBe("warn");
    expect(assessment.state).toBe("suspicious");
  });
});

describe("QualityGate — Extract Images (conservative)", () => {
  it("rates an image-bearing document healthy", async () => {
    const result = await runEngine(
      "current-pdf-lib-extract-images",
      [{ name: "scan.pdf", mimeType: "application/pdf", bytes: await makeScannedPdf(2) }],
      { pages: "all" },
    );

    expect(result.artifacts.length).toBeGreaterThan(0);
    expect(result.quality?.state).toBe("healthy");
    const volume = result.quality?.checks.find((c) => c.id === "image-content-volume");
    expect(volume?.state).toBe("pass");
  });

  it("treats zero extracted images as a low-weight diagnostic, not a failure", () => {
    const assessment = assessConversionQuality("extract-images", baseInput({
      meta: { extractedImagesCount: 0 },
    }));
    const volume = assessment.checks.find((c) => c.id === "image-content-volume");
    expect(volume?.state).toBe("warn");
    expect(volume?.weight).toBe(1);
    expect(assessment.state).toBe("suspicious");
  });

  it("accepts zero images when the source provably contains no image objects", () => {
    const assessment = assessConversionQuality("extract-images", baseInput({
      meta: { extractedImagesCount: 0 },
      profile: {
        profileVersion: 1,
        documentKind: "pdf",
        fileSizeBytes: 500,
        inputMimeType: "application/pdf",
        analysisState: "complete",
        pageCount: 1,
        imageBearingPageCount: 0,
        imageObjectCount: 0,
      },
    }));
    const volume = assessment.checks.find((c) => c.id === "image-content-volume");
    expect(volume?.state).toBe("pass");
    expect(assessment.state).toBe("healthy");
  });
});

describe("QualityGate — Extract Tables (conservative)", () => {
  it("passes when rows are detected", async () => {
    const result = await runEngine(
      "current-pdfium-tables",
      [{ name: "t.pdf", mimeType: "application/pdf", bytes: await pdfBytes(["ColA  ColB  ColC"]) }],
      { format: "csv" },
    );
    expect(result.artifacts.length).toBeGreaterThan(0);
    expect(result.quality?.state).toBe("healthy");
  });

  it("keeps a table-free document a low-weight diagnostic, never a failure", () => {
    const assessment = assessConversionQuality("extract-tables", baseInput({
      meta: { rowsExtracted: 0, tablesFound: 0 },
    }));
    const volume = assessment.checks.find((c) => c.id === "table-content-volume");
    expect(volume?.state).toBe("warn");
    expect(volume?.weight).toBe(1);
    expect(assessment.state).toBe("suspicious");
  });
});

describe("QualityGate — Images → PDF / PNG → PDF", () => {
  it("rates a real images-to-pdf conversion healthy", async () => {
    const result = await runEngine("current-pdf-lib-images", [
      { name: "a.jpg", mimeType: "image/jpeg", bytes: await makeJpeg(12, 9) },
      { name: "b.png", mimeType: "image/png", bytes: await makePng(8, 8) },
    ]);
    expect(result.artifacts.length).toBeGreaterThan(0);
    expect(result.quality?.state).toBe("healthy");
    const coverage = result.quality?.checks.find((c) => c.id === "output-page-coverage");
    expect(coverage?.state).toBe("pass");
  });

  it("warns when fewer pages than input images are produced", () => {
    const assessment = assessConversionQuality("images-to-pdf", baseInput({
      meta: { pages: 1 },
      inputFileCount: 3,
    }));
    const coverage = assessment.checks.find((c) => c.id === "output-page-coverage");
    expect(coverage?.state).toBe("warn");
  });
});

describe("QualityGate — Compress PDF", () => {
  it("does NOT judge quality from file-size changes", () => {
    const assessment = assessConversionQuality("compress-pdf", baseInput({
      meta: { originalBytes: 1_000_000, outputBytes: 1_000, bytesSaved: 999_000, reductionPercent: 99.9 },
    }));
    const fidelity = assessment.checks.find((c) => c.id === "compression-fidelity");
    expect(fidelity?.state).toBe("not-evaluated");
    expect(fidelity?.weight).toBe(0); // excluded from the score by design
    expect(assessment.state).toBe("healthy");
    expect(assessment.score).toBe(100);
  });
});

describe("QualityGate — Compare Documents", () => {
  it("invents no semantic score: the fidelity check is immaterial", async () => {
    const bytes = await pdfBytes(["Version A"]);
    const result = await runEngine("current-pdfium-compare", [
      { name: "a.pdf", mimeType: "application/pdf", bytes },
      { name: "b.pdf", mimeType: "application/pdf", bytes: await pdfBytes(["Version B"]) },
    ]);

    expect(result.artifacts.length).toBeGreaterThan(0);
    const fidelity = result.quality?.checks.find((c) => c.id === "semantic-fidelity");
    expect(fidelity?.state).toBe("not-evaluated");
    expect(fidelity?.weight).toBe(0);
    expect(result.quality?.state).toBe("healthy");
    // No invented numeric similarity metric exists anywhere in the result.
    expect(ids(result.quality!)).not.toContain("semantic-similarity");
  });
});

describe("QualityGate — validation interaction", () => {
  it("rates a structurally invalid output suspicious", () => {
    const assessment = assessConversionQuality("pdf-to-word", baseInput({
      validation: { status: "failed", checks: ["zip-container"] },
      meta: { characters: 300 },
    }));
    const structural = assessment.checks.find((c) => c.id === "output-structurally-valid");
    expect(structural?.state).toBe("warn");
    expect(assessment.state).toBe("suspicious");
  });

  it("accepts a structurally valid output with passing signals as healthy", () => {
    const assessment = assessConversionQuality("pdf-to-word", baseInput({
      validation: { status: "passed", checks: ["zip-container", "zip-required-parts"] },
      meta: { characters: 300 },
    }));
    expect(assessment.state).toBe("healthy");
  });

  it("can be suspicious while structurally valid — the two concepts differ", () => {
    const assessment = assessConversionQuality("pdf-to-word", baseInput({
      validation: { status: "passed", checks: ["zip-container"] },
      meta: { characters: 0 },
    }));
    expect(
      assessment.checks.find((c) => c.id === "output-structurally-valid")?.state,
    ).toBe("pass");
    expect(assessment.state).toBe("suspicious");
  });
});

describe("QualityGate — privacy", () => {
  it("never lets document content leak into the assessment", async () => {
    const sensitive = "John Smith, 123 Main Street, john@example.com, invoice #42";
    const result = await runEngine("current-pdfium-docx", [
      { name: "doc.pdf", mimeType: "application/pdf", bytes: await pdfBytes([sensitive]) },
    ]);

    expect(result.artifacts.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(result.quality);
    expect(serialised).not.toContain("John Smith");
    expect(serialised).not.toContain("Main Street");
    expect(serialised).not.toContain("john@example.com");
    expect(serialised).not.toContain("invoice #42");
    expect(serialised).not.toContain("doc.pdf");
  });
});

describe("QualityGate — behavioral equivalence (Phase 69 changes nothing user-visible)", () => {
  it("keeps quality OUT of the processing result meta", async () => {
    const bytes = await pdfBytes(["Service level"]);
    const result = await runProcessingJob({
      toolId: "pdf-to-word",
      files: [
        {
          id: "f1",
          name: "doc.pdf",
          size: bytes.length,
          mimeType: "application/pdf",
          bytes,
        },
      ],
    });

    expect(result.status).toBe("succeeded");
    if (result.status === "succeeded") {
      // Exactly the Phase 67 contract: processor meta + engineId + attempt
      // (Phase 75C added the additive `imagePages` embed count — no quality
      // key may ever appear here, which is this test's invariant).
      expect(Object.keys(result.meta ?? {}).sort()).toEqual(
        [
          "attempt",
          "characters",
          "engineId",
          "imagePages",
          "mode",
          "outputPages",
          "pages",
          "paragraphs",
        ].sort(),
      );
      expect(result.meta?.engineId).toBe("current-pdfium-docx");
      expect(result.meta?.attempt).toBe(1);
    }
  });

  it("attaches quality to the engine result without touching the artifacts", async () => {
    const bytes = await pdfBytes(["Hello"]);
    const word = await runEngine("current-pdfium-docx", [
      { name: "doc.pdf", mimeType: "application/pdf", bytes },
    ]);
    expect(word.quality?.state).toBe("healthy");
    expect(word.quality?.qualityVersion).toBe(1);
    expect(word.artifacts[0].name).toBe("doc.docx");

    const text = await runEngine(
      "current-pdfium-text",
      [{ name: "doc.pdf", mimeType: "application/pdf", bytes }],
      { pages: "all" },
    );
    expect(text.quality?.state).toBe("healthy");
    expect(text.artifacts[0].name).toBe("doc-text.txt");
  });

  it("keeps every conversion policy verdict within the defined states", () => {
    const states = ["not-evaluated", "healthy", "suspicious", "insufficient"];
    const conversions: ConversionType[] = [
      "compare-documents", "compress-pdf", "extract-images", "extract-tables",
      "images-to-pdf", "pdf-to-excel", "pdf-to-jpg", "pdf-to-png",
      "pdf-to-text", "pdf-to-word", "png-to-pdf",
    ];
    for (const conversion of conversions) {
      const assessment = assessConversionQuality(conversion, baseInput());
      expect(states).toContain(assessment.state);
      expect(assessment.score).toBeGreaterThanOrEqual(0);
      expect(assessment.score).toBeLessThanOrEqual(100);
      expect(assessment.qualityVersion).toBe(1);
    }
  });
});
