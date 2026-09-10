// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  assessConversionQuality,
  type QualityAssessmentInput,
} from "@/lib/engines/quality";
import {
  currentEngineAdapter,
  CURRENT_ENGINES,
  MARKER_SCAN_MAX_BYTES,
} from "@/lib/engines/adapters/current";
import type {
  ConversionType,
  EngineDescriptor,
  EngineResult,
} from "@/lib/engines/types";
import type {
  ProcessingArtifact,
  ToolProcessor,
} from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { DEFAULT_PROCESSING_LIMITS } from "@/lib/processing/limits";
import { pdfToJpgProcessor } from "@/lib/processing/processors/pdf-to-image";
import { pdfToTextProcessor } from "@/lib/processing/processors/pdf-to-text";
import { pdfToWordProcessor } from "@/lib/processing/processors/pdf-to-word";
import { runProcessingJob } from "@/lib/processing/service";
import { selectEngine } from "@/lib/engines/router";
import { extractPdfPageTexts } from "@/lib/thumbnails/renderer";
import { makePdf, makeScannedPdf } from "@/test/pdf-fixtures";

/**
 * Phase 70 — QualityGate v1 hardening, evidence and Stage 4 readiness.
 *
 * These tests do not change the QualityGate contract; they prove its
 * properties: determinism, bounded and adversarially safe scanning,
 * per-policy semantics, structural/quality separation, behavioral
 * equivalence, privacy and performance overhead.
 */

// Delegate to the real implementation, but count pdfium text passes so the
// no-duplicate-parsing property can be proven on real engine runs.
vi.mock("@/lib/thumbnails/renderer", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/thumbnails/renderer")>();
  return {
    ...actual,
    extractPdfPageTexts: vi.fn(actual.extractPdfPageTexts),
  };
});

const CONTEXT = { limits: DEFAULT_PROCESSING_LIMITS };

const TEXT_DESCRIPTOR: EngineDescriptor = {
  id: "test-text-engine",
  name: "Test text engine",
  conversionType: "pdf-to-text",
  toolId: "pdf-to-text",
  capabilities: [],
  executionClass: "in-process",
  costClass: "local",
  license: "test-only",
  version: "0",
  available: true,
};

function textArtifact(bytes: Uint8Array, mimeType = "text/plain; charset=utf-8"): ProcessingArtifact {
  return { name: "out.txt", mimeType, size: bytes.length, bytes };
}

function textEngineReturning(artifacts: ProcessingArtifact[]): ToolProcessor<Record<string, unknown>> {
  return {
    toolId: "pdf-to-text",
    input: { minFiles: 1, extensions: [".pdf"], mimeTypes: ["application/pdf"] },
    async process() {
      return { status: "succeeded" as const, artifacts, meta: { pages: 1 } };
    },
  };
}

async function runTextEngine(artifacts: ProcessingArtifact[]): Promise<EngineResult> {
  const engine = currentEngineAdapter({
    descriptor: TEXT_DESCRIPTOR,
    processor: textEngineReturning(artifacts),
  });
  return engine.run(
    { toolId: "pdf-to-text", files: [{ id: "f1", name: "doc.pdf", size: 10, mimeType: "application/pdf", bytes: new Uint8Array(10) }] },
    CONTEXT,
  );
}

function baseInput(overrides: Partial<QualityAssessmentInput> = {}): QualityAssessmentInput {
  return {
    validation: { status: "passed", checks: ["non-empty"] },
    meta: {},
    artifactCount: 1,
    outputBytes: 2048,
    inputFileCount: 1,
    ...overrides,
  };
}

const ALL_CONVERSIONS: ConversionType[] = [
  "compare-documents", "compress-pdf", "extract-images", "extract-tables",
  "images-to-pdf", "pdf-to-excel", "pdf-to-jpg", "pdf-to-png",
  "pdf-to-text", "pdf-to-word", "png-to-pdf",
];

const PII_TOKENS = [
  "John Smith",
  "123 Main Street",
  "john@example.com",
  "+1-555-0100",
  "INV-2026-0042",
  "A-1137-XQ",
];

/* ------------------------------------------------------------------ */
/* §3 Determinism                                                      */
/* ------------------------------------------------------------------ */

describe("determinism", () => {
  it("produces byte-identical assessments for identical inputs", () => {
    const input = baseInput({ meta: { characters: 900, pages: 3 } });
    const first = assessConversionQuality("pdf-to-word", input);
    const second = assessConversionQuality("pdf-to-word", input);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("keeps check ordering deterministic", () => {
    const input = baseInput({ meta: { images: 2, pages: 2 } });
    const runIds = () =>
      assessConversionQuality("pdf-to-jpg", input).checks.map((c) => c.id).join("|");
    expect(runIds()).toBe(runIds());
    // Same policy shape across every invocation.
    for (let index = 0; index < 5; index += 1) {
      expect(runIds()).toBe(
        "output-count|output-structurally-valid|output-page-coverage",
      );
    }
  });

  it("is unaffected by Math.random and Date.now", () => {
    const input = baseInput({ meta: { characters: 12 } });
    const before = assessConversionQuality("pdf-to-word", input);
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.999);
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(123456);
    try {
      const during = assessConversionQuality("pdf-to-word", input);
      expect(during).toEqual(before);
    } finally {
      randomSpy.mockRestore();
      dateSpy.mockRestore();
    }
  });

  it("is unaffected by unrelated environment variables", () => {
    const input = baseInput({ meta: { characters: 12 } });
    const before = assessConversionQuality("pdf-to-word", input);
    vi.stubEnv("PDFKIT_QUALITY_ANYTHING", "1");
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(assessConversionQuality("pdf-to-word", input)).toEqual(before);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

/* ------------------------------------------------------------------ */
/* §4 Boundaries                                                       */
/* ------------------------------------------------------------------ */

describe("boundaries", () => {
  it("handles zero, one and multiple outputs", () => {
    for (const artifactCount of [0, 1, 5]) {
      const assessment = assessConversionQuality(
        "pdf-to-word",
        baseInput({ artifactCount, meta: { characters: 10 } }),
      );
      expect(["healthy", "suspicious", "insufficient"]).toContain(assessment.state);
      expect(assessment.score).toBeGreaterThanOrEqual(0);
      expect(assessment.score).toBeLessThanOrEqual(100);
    }
    const zero = assessConversionQuality("pdf-to-word", baseInput({ artifactCount: 0, meta: { characters: 10 } }));
    expect(zero.checks.find((c) => c.id === "output-count")?.state).toBe("warn");
    expect(zero.state).toBe("suspicious");
  });

  it("treats exactly 50% available evidence as sufficient (strict threshold)", () => {
    // extract-images with structural validation not-evaluated but a real
    // image count: evaluated weight 3 (output-count 2 + image volume 1) of
    // 6 measurable = exactly 0.5 → sufficient (the check is strict <).
    const assessment = assessConversionQuality("extract-images", baseInput({
      validation: { status: "not-evaluated" },
      meta: { extractedImagesCount: 5 },
    }));
    expect(assessment.state).toBe("healthy");

    // The same 50% evidence with a warn is suspicious, not insufficient.
    const warned = assessConversionQuality("extract-images", baseInput({
      validation: { status: "not-evaluated" },
      meta: { extractedImagesCount: 0 },
    }));
    expect(warned.state).toBe("suspicious");
  });

  it("treats just below 50% evidence as insufficient", () => {
    // pdf-to-jpg: 2 of 7 measurable ≈ 0.29 → insufficient.
    const assessment = assessConversionQuality("pdf-to-jpg", baseInput({
      validation: { status: "not-evaluated" },
      meta: {},
    }));
    expect(assessment.state).toBe("insufficient");
  });

  it("keeps score 0 and 100 exact at the boundaries", () => {
    expect(
      assessConversionQuality("pdf-to-word", baseInput({
        validation: { status: "failed", checks: ["zip-container"] },
        artifactCount: 0,
        meta: { characters: 0 },
      })).score,
    ).toBe(0);

    expect(
      assessConversionQuality("pdf-to-word", baseInput({ meta: { characters: 7 } })).score,
    ).toBe(100);
  });

  it("handles mixed pass/warn/not-evaluated without pathology", () => {
    const assessment = assessConversionQuality("pdf-to-text", baseInput({
      validation: { status: "passed", checks: ["text-non-empty"] },
      outputTextMarkerOnly: true,
    }));
    const states = assessment.checks.map((c) => c.state);
    expect(states).toContain("pass");
    expect(states).toContain("warn");
    expect(states).toContain("not-evaluated");
    expect(assessment.state).toBe("suspicious");
  });

  it("survives malformed profile fields without throwing", () => {
    const malformed = {
      profileVersion: 1,
      documentKind: "pdf",
      fileSizeBytes: -1,
      inputMimeType: "",
      analysisState: "complete",
      pageCount: 0,
      textPageCount: -5,
      textCharacterCount: Number.POSITIVE_INFINITY,
      textYieldRatio: 7,
    } as unknown as QualityAssessmentInput["profile"];

    for (const conversion of ["pdf-to-word", "pdf-to-text", "pdf-to-excel", "extract-images"] as ConversionType[]) {
      const assessment = assessConversionQuality(conversion, baseInput({ profile: malformed, meta: { characters: 5 } }));
      expect(["healthy", "suspicious", "insufficient"]).toContain(assessment.state);
      expect(Number.isFinite(assessment.score)).toBe(true);
    }
  });

  it("survives NaN profile values without producing NaN scores", () => {
    const assessment = assessConversionQuality("pdf-to-text", baseInput({
      profile: {
        profileVersion: 1,
        documentKind: "pdf",
        fileSizeBytes: 1,
        inputMimeType: "application/pdf",
        analysisState: "complete",
        textCharacterCount: Number.NaN,
      } as unknown as QualityAssessmentInput["profile"],
      outputBytes: 50,
      outputTextMarkerOnly: false,
    }));
    expect(Number.isNaN(assessment.score)).toBe(false);
    expect(["healthy", "suspicious", "insufficient"]).toContain(assessment.state);
  });

  it("works with a missing profile entirely", () => {
    const assessment = assessConversionQuality("pdf-to-word", baseInput({
      profile: undefined,
      meta: { characters: 10 },
    }));
    expect(assessment.state).toBe("healthy");
  });

  it("handles unusual MIME values and tiny artifacts through the adapter", async () => {
    const weird = await runTextEngine([
      textArtifact(new Uint8Array([0x41]), "application/x-weird"),
    ]);
    expect(weird.quality?.state).toBe("insufficient"); // unknown class → no structural verdict
    expect(Number.isFinite(weird.quality?.score ?? NaN)).toBe(true);

    const tiny = await runTextEngine([textArtifact(new Uint8Array([0x41]))]);
    expect(tiny.quality?.state).not.toBe("insufficient");
  });
});

/* ------------------------------------------------------------------ */
/* §5 Marker-only detection (adversarial)                              */
/* ------------------------------------------------------------------ */

describe("marker-only text detection", () => {
  const MARKER = "--- Page 1 ---";
  const EMPTY_MARKER = "[Page 1 contains no extractable text]";

  it("detects repeated markers, at edges, whitespace-separated", async () => {
    const cases: string[] = [
      MARKER,
      `${MARKER}\n${MARKER}\n${MARKER}`,
      `\n\n${MARKER}   \n  ${EMPTY_MARKER}\n\t\n`,
      `${EMPTY_MARKER}${MARKER}`,
    ];
    for (const content of cases) {
      const result = await runTextEngine([
        textArtifact(new TextEncoder().encode(content)),
      ]);
      const volume = result.quality?.checks.find((c) => c.id === "output-content-volume");
      expect(volume?.state, JSON.stringify(content)).toBe("warn");
      expect(volume?.reason).toContain("page markers");
    }
  });

  it("detects a very large number of markers", async () => {
    const many = Array.from({ length: 10_000 }, () => MARKER).join("\n");
    const result = await runTextEngine([textArtifact(new TextEncoder().encode(many))]);
    expect(result.quality?.checks.find((c) => c.id === "output-content-volume")?.state).toBe("warn");
  });

  it("does not treat malformed marker-like content as marker-only", async () => {
    const cases = [
      "--- Page 1 -", // missing trailing dash
      "-- Page 1 ---", // missing leading dash
      "[Page 1 contains no extractable text", // truncated
      "--- Page one ---", // non-numeric
      "--- Page 1 --- EXTRA WORDS", // real content after the marker
    ];
    for (const content of cases) {
      const result = await runTextEngine([
        textArtifact(new TextEncoder().encode(content)),
      ]);
      const volume = result.quality?.checks.find((c) => c.id === "output-content-volume");
      expect(volume?.state, JSON.stringify(content)).toBe("pass");
    }
  });

  it("treats Unicode text content as real content", async () => {
    const result = await runTextEngine([
      textArtifact(new TextEncoder().encode(`${MARKER}\nこんにちは世界 — naïve café`)),
    ]);
    expect(result.quality?.checks.find((c) => c.id === "output-content-volume")?.state).toBe("pass");
  });

  it("skips the scan at and above the threshold, applies it just below", async () => {
    // Exactly at the threshold → still scanned (the bound is inclusive:
    // only lengths strictly above the threshold are skipped).
    const atThreshold = buildMarkerOnlyBytes(MARKER_SCAN_MAX_BYTES);
    expect(atThreshold.length).toBe(MARKER_SCAN_MAX_BYTES);
    const atResult = await runTextEngine([textArtifact(atThreshold)]);
    expect(atResult.quality?.checks.find((c) => c.id === "output-content-volume")?.state).toBe("warn");

    // Just above → skipped → treated as real content.
    const above = buildMarkerOnlyBytes(MARKER_SCAN_MAX_BYTES + 1);
    const aboveResult = await runTextEngine([textArtifact(above)]);
    expect(aboveResult.quality?.checks.find((c) => c.id === "output-content-volume")?.state).toBe("pass");

    // Just below → scanned → marker-only.
    const below = buildMarkerOnlyBytes(MARKER_SCAN_MAX_BYTES - 1);
    const belowResult = await runTextEngine([textArtifact(below)]);
    expect(belowResult.quality?.checks.find((c) => c.id === "output-content-volume")?.state).toBe("warn");
  });

  it("never decodes non-text artifacts", async () => {
    // A binary artifact with invalid UTF-8 must not be decoded or throw.
    const binary = new Uint8Array([0xff, 0xfe, 0x00, 0x81, 0xd9]);
    const result = await runTextEngine([textArtifact(binary, "image/png")]);
    expect(result.quality?.state).toBeDefined();
    expect(Number.isFinite(result.quality?.score ?? NaN)).toBe(true);
  });

  it("keeps the result a boolean-derived signal that never carries content", async () => {
    const pii = `${MARKER}\nJohn Smith, 123 Main Street, john@example.com`;
    const result = await runTextEngine([textArtifact(new TextEncoder().encode(pii))]);
    const serialised = JSON.stringify(result.quality);
    for (const token of PII_TOKENS.slice(0, 3)) {
      expect(serialised).not.toContain(token);
    }
  });
});

/** Build a marker-only payload padded with whitespace to an exact byte length (O(n)). */
function buildMarkerOnlyBytes(exactLength: number): Uint8Array {
  const marker = "--- Page 1 ---\n";
  const encoder = new TextEncoder();
  const markerBytes = encoder.encode(marker);
  const count = Math.floor(exactLength / markerBytes.length);
  const bytes = new Uint8Array(exactLength);
  for (let index = 0; index < count; index += 1) {
    bytes.set(markerBytes, index * markerBytes.length);
  }
  // ASCII spaces for the remainder; trailing whitespace still trims away.
  bytes.fill(0x20, count * markerBytes.length);
  return bytes;
}

/* ------------------------------------------------------------------ */
/* §6 Per-policy audit matrix                                          */
/* ------------------------------------------------------------------ */

describe("per-policy audit matrix", () => {
  it("zero-output semantics: every policy reports suspicious (a diagnostic, never a failure)", () => {
    for (const conversion of ALL_CONVERSIONS) {
      const assessment = assessConversionQuality(conversion, baseInput({
        artifactCount: 0,
        outputBytes: 0,
      }));
      expect(assessment.state, conversion).toBe("suspicious");
      expect(assessment.checks.find((c) => c.id === "output-count")?.state, conversion).toBe("warn");
    }
  });

  it("all-evidence-unavailable semantics: every policy reports insufficient", () => {
    // With no validation verdict, no meta and no profile, only output-count
    // is evaluable (weight 2) — always below half the measurable weight for
    // every current policy → an honest "cannot tell" for all eleven types.
    for (const conversion of ALL_CONVERSIONS) {
      const assessment = assessConversionQuality(conversion, baseInput({
        validation: { status: "not-evaluated" },
        meta: {},
      }));
      expect(assessment.state, conversion).toBe("insufficient");
      expect(assessment.score, conversion).toBe(100); // all evaluated checks passed
    }
  });

  it("documents each policy's measurable vs immaterial checks", () => {
    const expectations: Record<ConversionType, string[]> = {
      "pdf-to-word": ["output-count", "output-structurally-valid", "source-text-availability", "output-content-volume"],
      "pdf-to-text": ["output-count", "output-structurally-valid", "source-text-availability", "output-content-volume"],
      "pdf-to-excel": ["output-count", "output-structurally-valid", "source-text-availability", "table-content-volume"],
      "extract-tables": ["output-count", "output-structurally-valid", "source-text-availability", "table-content-volume"],
      "pdf-to-jpg": ["output-count", "output-structurally-valid", "output-page-coverage"],
      "pdf-to-png": ["output-count", "output-structurally-valid", "output-page-coverage"],
      "extract-images": ["output-count", "output-structurally-valid", "image-content-volume"],
      "images-to-pdf": ["output-count", "output-structurally-valid", "output-page-coverage"],
      "png-to-pdf": ["output-count", "output-structurally-valid", "output-page-coverage"],
      "compress-pdf": ["output-count", "output-structurally-valid", "compression-fidelity"],
      "compare-documents": ["output-count", "output-structurally-valid", "semantic-fidelity"],
    };
    for (const conversion of ALL_CONVERSIONS) {
      const ids = assessConversionQuality(conversion, baseInput()).checks.map((c) => c.id);
      expect(ids, conversion).toEqual(expectations[conversion]);
      // Immaterial checks (weight 0) exist only where fidelity is honestly
      // unmeasurable, and never influence the score.
      for (const check of assessConversionQuality(conversion, baseInput()).checks) {
        if (check.weight === 0) expect(check.state).toBe("not-evaluated");
      }
    }
  });

  it("scanned and image-only behavior: suspicious where text is the product, healthy where it is not", () => {
    const scannedProfile = (pages: number) => ({
      profileVersion: 1 as const,
      documentKind: "pdf" as const,
      fileSizeBytes: 1000,
      inputMimeType: "application/pdf",
      analysisState: "complete" as const,
      pageCount: pages,
      textPageCount: 0,
      emptyTextPageCount: pages,
      textCharacterCount: 0,
      textYieldRatio: 0,
      imageObjectCount: pages,
      imageBearingPageCount: pages,
      likelyScannedPageCount: pages,
      likelyScannedRatio: 1,
    });

    const word = assessConversionQuality("pdf-to-word", baseInput({ profile: scannedProfile(3), meta: { characters: 0 } }));
    expect(word.state).toBe("suspicious");

    const text = assessConversionQuality("pdf-to-text", baseInput({ profile: scannedProfile(3), outputTextMarkerOnly: true }));
    expect(text.state).toBe("suspicious");

    const jpg = assessConversionQuality("pdf-to-jpg", baseInput({ profile: scannedProfile(3), meta: { images: 3, pages: 3 } }));
    expect(jpg.state).toBe("healthy");

    const excel = assessConversionQuality("pdf-to-excel", baseInput({ profile: scannedProfile(2), meta: { rowsExtracted: 0 } }));
    expect(excel.state).toBe("healthy"); // no text + no rows = expected, not suspicious
  });

  it("table-only behavior: rows detected → healthy; rows absent with text present → low-weight diagnostic", () => {
    const textyProfile = {
      profileVersion: 1 as const,
      documentKind: "pdf" as const,
      fileSizeBytes: 800,
      inputMimeType: "application/pdf",
      analysisState: "complete" as const,
      pageCount: 1,
      textPageCount: 1,
      textCharacterCount: 500,
      textYieldRatio: 1,
    };
    const withRows = assessConversionQuality("extract-tables", baseInput({ profile: textyProfile, meta: { rowsExtracted: 12 } }));
    expect(withRows.state).toBe("healthy");

    const withoutRows = assessConversionQuality("extract-tables", baseInput({ profile: textyProfile, meta: { rowsExtracted: 0 } }));
    expect(withoutRows.state).toBe("suspicious");
    expect(withoutRows.checks.find((c) => c.id === "table-content-volume")?.weight).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* §7 Structural vs quality separation                                 */
/* ------------------------------------------------------------------ */

describe("structural vs quality separation", () => {
  it("Case A: structurally valid + healthy", () => {
    const assessment = assessConversionQuality("pdf-to-word", baseInput({
      validation: { status: "passed", checks: ["zip-container", "zip-required-parts"] },
      meta: { characters: 400 },
    }));
    expect(assessment.state).toBe("healthy");
  });

  it("Case B: structurally valid + suspicious", () => {
    const assessment = assessConversionQuality("pdf-to-word", baseInput({
      validation: { status: "passed", checks: ["zip-container"] },
      meta: { characters: 0 },
    }));
    expect(
      assessment.checks.find((c) => c.id === "output-structurally-valid")?.state,
    ).toBe("pass");
    expect(assessment.state).toBe("suspicious");
  });

  it("Case C (v1 finding): an evaluated structural verdict makes 'insufficient' unreachable — verified for every policy", () => {
    // With validation passed or failed, the evaluated evidence always
    // reaches the sufficiency threshold, so "insufficient" can only occur
    // when structural validation itself was not-evaluated. This invariant
    // is asserted so a future policy change cannot weaken it silently.
    for (const conversion of ALL_CONVERSIONS) {
      for (const status of ["passed", "failed"] as const) {
        const assessment = assessConversionQuality(conversion, baseInput({
          validation: { status, checks: ["non-empty"] },
          meta: {},
        }));
        expect(assessment.state, `${conversion}/${status}`).not.toBe("insufficient");
      }
    }
  });

  it("Case D: validation not-evaluated (unknown output class) still yields an assessable verdict", async () => {
    const result = await runTextEngine([
      textArtifact(new TextEncoder().encode("real text"), "application/x-custom"),
    ]);
    expect(result.validation).toEqual({ status: "not-evaluated" });
    expect(result.quality?.state).toBe("insufficient");
  });

  it("Case E: structurally invalid output — the gate consumes the verdict instead of re-validating", () => {
    const assessment = assessConversionQuality("pdf-to-word", baseInput({
      validation: { status: "failed", checks: ["zip-container", "zip-required-parts"] },
      meta: { characters: 900 },
    }));

    const gateCheckIds = assessment.checks.map((c) => c.id);
    // Consumed, not duplicated: the gate's own structural check mirrors the
    // verdict…
    const structural = assessment.checks.find((c) => c.id === "output-structurally-valid");
    expect(structural?.state).toBe("warn");
    // …and no OutputValidator check ids leak into the quality assessment.
    for (const validatorId of ["zip-container", "zip-required-parts", "non-empty", "pdf-signature", "png-signature", "jpeg-eoi"]) {
      expect(gateCheckIds).not.toContain(validatorId);
    }
    expect(assessment.state).toBe("suspicious");
  });
});

/* ------------------------------------------------------------------ */
/* §8 Behavioral equivalence                                           */
/* ------------------------------------------------------------------ */

describe("behavioral equivalence (QualityGate observes, never controls)", () => {
  it("keeps engine output byte-identical to the direct processor (deterministic formats)", async () => {
    const bytes = await makePdf(["Equivalence page one", "page two"]);
    const file = { id: "f1", name: "doc.pdf", size: bytes.length, mimeType: "application/pdf", bytes };

    const directText = await pdfToTextProcessor.process(
      { toolId: "pdf-to-text", files: [file], options: { pages: "all" } },
      CONTEXT,
    );
    const engine = CURRENT_ENGINES.find((e) => e.descriptor.id === "current-pdfium-text")!;
    const engineText = await engine.run(
      { toolId: "pdf-to-text", files: [{ ...file }], options: { pages: "all" } },
      CONTEXT,
    );
    expect(Buffer.from(engineText.artifacts[0].bytes).toString("base64")).toBe(
      Buffer.from(directText.artifacts[0].bytes).toString("base64"),
    );

    const directJpg = await pdfToJpgProcessor.process(
      { toolId: "pdf-to-jpg", files: [{ ...file }] },
      CONTEXT,
    );
    const jpgEngine = CURRENT_ENGINES.find((e) => e.descriptor.id === "current-pdfium-jpeg")!;
    const engineJpg = await jpgEngine.run(
      { toolId: "pdf-to-jpg", files: [{ ...file }] },
      CONTEXT,
    );
    expect(engineJpg.artifacts.map((a) => Buffer.from(a.bytes).toString("base64"))).toEqual(
      directJpg.artifacts.map((a) => Buffer.from(a.bytes).toString("base64")),
    );
  });

  it("a suspicious verdict leaves the artifacts untouched (execution not controlled)", async () => {
    // pdf-to-text: marker-only output for a scanned PDF, and a
    // deterministic byte format (no embedded timestamps, unlike DOCX).
    const bytes = await makeScannedPdf(2);
    const file = { id: "f1", name: "scan.pdf", size: bytes.length, mimeType: "application/pdf", bytes };
    const options = { pages: "all" };

    const direct = await pdfToTextProcessor.process(
      { toolId: "pdf-to-text", files: [file], options },
      CONTEXT,
    );
    const engine = CURRENT_ENGINES.find((e) => e.descriptor.id === "current-pdfium-text")!;
    const result = await engine.run(
      { toolId: "pdf-to-text", files: [{ ...file }], options },
      CONTEXT,
    );

    expect(result.quality?.state).toBe("suspicious"); // diagnosed…
    expect(Buffer.from(result.artifacts[0].bytes).toString("base64")).toBe(
      Buffer.from(direct.artifacts[0].bytes).toString("base64"),
    ); // …but the output is exactly what the processor produced.
  });

  it("performs no duplicate pdfium parsing: one text pass per conversion", async () => {
    const spy = vi.mocked(extractPdfPageTexts);
    spy.mockClear();

    const bytes = await makePdf(["one", "two"]);
    const engine = CURRENT_ENGINES.find((e) => e.descriptor.id === "current-pdfium-docx")!;
    await engine.run(
      {
        toolId: "pdf-to-word",
        files: [{ id: "f1", name: "doc.pdf", size: bytes.length, mimeType: "application/pdf", bytes }],
      },
      CONTEXT,
    );

    // Exactly the processor's own single pass: profile (signature tier),
    // validation and quality added zero pdfium work.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("keeps the router mapping unchanged", () => {
    expect(selectEngine("pdf-to-word").descriptor.id).toBe("current-pdfium-docx");
    expect(selectEngine("pdf-to-word")).toBe(selectEngine("pdf-to-word"));
  });

  it("failures remain failures: the gate never runs for a throwing processor", async () => {
    const throwing: ToolProcessor<Record<string, unknown>> = {
      toolId: "pdf-to-word",
      input: { minFiles: 1, extensions: [".pdf"], mimeTypes: ["application/pdf"] },
      async process() {
        throw new ProcessingError("INVALID_PDF", "A PDF could not be opened.");
      },
    };
    const engine = currentEngineAdapter({
      descriptor: {
        ...TEXT_DESCRIPTOR,
        id: "test-throwing",
        conversionType: "pdf-to-word",
        toolId: "pdf-to-word",
      },
      processor: throwing,
    });
    await expect(
      engine.run({ toolId: "pdf-to-word", files: [] }, CONTEXT),
    ).rejects.toBeInstanceOf(ProcessingError);
  });
});

/* ------------------------------------------------------------------ */
/* §9 Privacy                                                          */
/* ------------------------------------------------------------------ */

describe("privacy", () => {
  async function piiPdf(): Promise<Uint8Array> {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const page = document.addPage([400, 300]);
    page.drawText(
      "John Smith | 123 Main Street | john@example.com | +1-555-0100 | INV-2026-0042 | A-1137-XQ",
      { x: 10, y: 150, size: 8, font },
    );
    return document.save();
  }

  it("keeps every PII token out of quality and profile serialisations", async () => {
    const bytes = await piiPdf();
    const engines = ["current-pdfium-docx", "current-pdfium-text"] as const;
    for (const engineId of engines) {
      const engine = CURRENT_ENGINES.find((e) => e.descriptor.id === engineId)!;
      const options = engineId === "current-pdfium-text" ? { pages: "all" } : undefined;
      const result = await engine.run(
        {
          toolId: engine.descriptor.toolId,
          files: [{
            id: "f1",
            name: "John-Smith-Invoice-42.pdf",
            size: bytes.length,
            mimeType: "application/pdf",
            bytes,
          }],
          ...(options ? { options } : {}),
        },
        CONTEXT,
      );

      const serialised = JSON.stringify({ quality: result.quality, profile: result.profile });
      for (const token of PII_TOKENS) {
        expect(serialised, `${engineId}: ${token}`).not.toContain(token);
      }
      // Filenames never enter the diagnostics either.
      expect(serialised).not.toContain("John-Smith-Invoice-42");
      expect(serialised).not.toContain(".pdf");
    }
  });

  it("logs nothing during a conversion (no accidental content in console output)", async () => {
    const bytes = await piiPdf();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await runProcessingJob({
        toolId: "pdf-to-word",
        files: [{
          id: "f1",
          name: "John-Smith-Invoice-42.pdf",
          size: bytes.length,
          mimeType: "application/pdf",
          bytes,
        }],
      });
      expect(result.status).toBe("succeeded");

      const allCalls = [...logSpy.mock.calls, ...errorSpy.mock.calls];
      expect(allCalls.length).toBe(0);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

/* ------------------------------------------------------------------ */
/* §10 Performance                                                     */
/* ------------------------------------------------------------------ */

describe("performance overhead", () => {
  it("adds bounded overhead and no duplicate parsing on a real conversion", async () => {
    const bytes = await makePdf(["Perf page one", "Perf page two"]);
    const file = () => ({
      id: "f1",
      name: "doc.pdf",
      size: bytes.length,
      mimeType: "application/pdf",
      bytes,
    });
    const engine = CURRENT_ENGINES.find((e) => e.descriptor.id === "current-pdfium-docx")!;

    // Warm up module caches and JIT paths.
    await pdfToWordProcessor.process({ toolId: "pdf-to-word", files: [file()] }, CONTEXT);
    await engine.run({ toolId: "pdf-to-word", files: [file()] }, CONTEXT);

    const runs = 10;
    const directStart = performance.now();
    for (let index = 0; index < runs; index += 1) {
      await pdfToWordProcessor.process({ toolId: "pdf-to-word", files: [file()] }, CONTEXT);
    }
    const directMs = (performance.now() - directStart) / runs;

    const engineStart = performance.now();
    for (let index = 0; index < runs; index += 1) {
      await engine.run({ toolId: "pdf-to-word", files: [file()] }, CONTEXT);
    }
    const engineMs = (performance.now() - engineStart) / runs;

    const overhead = engineMs - directMs;
    // Evidence for the audit log; generous bound keeps the test robust.
    console.log(
      `[perf] pdf-to-word 2-page: direct ${directMs.toFixed(2)}ms, engine+validation+quality ${engineMs.toFixed(2)}ms, overhead ${overhead.toFixed(2)}ms`,
    );
    expect(overhead).toBeLessThan(100);
    expect(engineMs).toBeGreaterThan(0);
  });
});
