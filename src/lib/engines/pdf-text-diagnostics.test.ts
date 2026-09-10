// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { currentPdfToTextEngine } from "@/lib/engines/adapters/current";
import { pdfjsTextEngine } from "@/lib/engines/adapters/pdfjs-text";
import { processorEngineAdapter } from "@/lib/engines/adapters/processor-engine";
import {
  PDF_TEXT_DIAGNOSTICS_VARIABLE,
  bucketDurationMs,
  bucketInputBytes,
  bucketPageCount,
  classifyPdfTextErrorCode,
  isPdfTextDiagnosticsEnabled,
} from "@/lib/engines/pdf-text-diagnostics";
import { selectEngine } from "@/lib/engines/router";
import { getDefaultEngineRegistry } from "@/lib/engines/registry";
import { resolveConfiguredAlternativeEngine } from "@/lib/engines/engine-config";
import { runProcessingJob } from "@/lib/processing/service";
import { DEFAULT_PROCESSING_LIMITS } from "@/lib/processing/limits";
import { ProcessingError } from "@/lib/processing/errors";
import {
  getTelemetrySnapshot,
  recordTelemetryEvent,
  resetTelemetry,
  setMetricsProviderForTests,
} from "@/lib/monitoring/telemetry";
import type { MetricsProvider } from "@/lib/monitoring/metrics/types";
import { makeBrokenPdf, makePdf } from "@/test/pdf-fixtures";

/**
 * Phase 74 §18 test matrix for the PDF → text engine diagnostics:
 * correctness, privacy, behavior preservation, failure isolation,
 * QualityGate isolation, engine isolation, gate preservation, security.
 *
 * The invariant under test everywhere: diagnostics are EVIDENCE, never
 * ROUTING — and they can never change what a user receives.
 */

const DIAG_ENV = PDF_TEXT_DIAGNOSTICS_VARIABLE;
const ENGINE_ENV = "PDFKIT_PDF_TO_TEXT_ENGINE";

const PRIVACY_TOKENS = [
  "Priya Raman", // a person's name planted in the document
  "priya.raman@example.org", // an email address
  "+91 98765 43210", // a phone number
  "phase74-invoice-90210", // an invoice marker
  "Phase74-Secret-Filename", // the upload filename
  "Phase74 Secret Title", // PDF metadata title
  "phase74-author-marker", // PDF metadata author
];

let previousDiag: string | undefined;
let previousEngine: string | undefined;

beforeEach(() => {
  previousDiag = process.env[DIAG_ENV];
  previousEngine = process.env[ENGINE_ENV];
  delete process.env[DIAG_ENV];
  delete process.env[ENGINE_ENV];
  resetTelemetry();
});

afterEach(() => {
  if (previousDiag === undefined) delete process.env[DIAG_ENV];
  else process.env[DIAG_ENV] = previousDiag;
  if (previousEngine === undefined) delete process.env[ENGINE_ENV];
  else process.env[ENGINE_ENV] = previousEngine;
  setMetricsProviderForTests(undefined);
  vi.restoreAllMocks();
});

function pdfRequest(
  bytes: Uint8Array,
  options: Record<string, unknown> = { pages: "all" },
  name = "doc.pdf",
) {
  return {
    toolId: "pdf-to-text",
    files: [
      { id: "f1", name, size: bytes.length, mimeType: "application/pdf", bytes },
    ],
    options,
  };
}

async function runCurrent(
  bytes: Uint8Array,
  options?: Record<string, unknown>,
  name?: string,
) {
  return currentPdfToTextEngine.run(pdfRequest(bytes, options, name), {
    limits: DEFAULT_PROCESSING_LIMITS,
  });
}

function pdfTextSnapshot() {
  return getTelemetrySnapshot({}).pdfText;
}

function snapshotJson(): string {
  return JSON.stringify(getTelemetrySnapshot({}));
}

/** The closed vocabulary every label in the pdfText snapshot must come from. */
const ALLOWED_LABELS = new Set([
  "current-pdfium-text",
  "pdfjs-text",
  "other",
  "test-throwing-engine",
  "success",
  "technical_failure",
  "validation_failure",
  // Typed codes as carried by the event (canonical) and as sanitized
  // (lowercased) snapshot keys — the provider's existing convention.
  "INVALID_PDF",
  "ENCRYPTED_PDF",
  "TOO_MANY_OUTPUTS",
  "PROCESSING_ERROR",
  "VALIDATION_ERROR",
  "INTERNAL_ERROR",
  "invalid_pdf",
  "encrypted_pdf",
  "too_many_outputs",
  "processing_error",
  "validation_error",
  "internal_error",
  "unknown",
  "healthy",
  "suspicious",
  "insufficient",
  "not-evaluated",
  "passed",
  "failed",
  "lt-100ms",
  "100-500ms",
  "500ms-1s",
  "1-5s",
  "gt-5s",
  "0-100kb",
  "100kb-1mb",
  "1mb-5mb",
  "5mb-10mb",
  "gt-10mb",
  "1",
  "2-5",
  "6-20",
  "21-60",
  "gt-60",
]);

/**
 * Every label KEY in the pdfText label maps (engine ids, codes, states,
 * buckets) is closed-vocabulary and bounded — structural keys and numeric
 * counters are not labels.
 */
function assertClosedVocabulary(): void {
  const pdfText = pdfTextSnapshot();
  const labels = [
    ...Object.keys(pdfText.byEngine),
    ...Object.keys(pdfText.failureCodes),
    ...Object.keys(pdfText.qualityStates),
    ...Object.keys(pdfText.validationStatuses),
    ...Object.keys(pdfText.durationBuckets),
    ...Object.keys(pdfText.inputSizeBuckets),
    ...Object.keys(pdfText.pageCountBuckets),
  ];
  expect(labels.length).toBeGreaterThan(0);
  for (const label of labels) {
    expect(
      ALLOWED_LABELS.has(label),
      `label "${label}" is outside the closed vocabulary`,
    ).toBe(true);
    expect(label.length).toBeLessThanOrEqual(64);
    expect(label).not.toMatch(/[\s\n\r]/); // no log-injection whitespace
  }
}

describe("classification and buckets (pure functions)", () => {
  it("classifies only request-validation as a non-technical outcome", () => {
    expect(classifyPdfTextErrorCode("VALIDATION_ERROR")).toBe("validation_failure");
    for (const code of [
      "INVALID_PDF",
      "ENCRYPTED_PDF",
      "TOO_MANY_OUTPUTS",
      "PROCESSING_ERROR",
      "INTERNAL_ERROR",
    ]) {
      expect(classifyPdfTextErrorCode(code)).toBe("technical_failure");
    }
  });

  it("buckets durations, sizes and page counts into closed sets", () => {
    expect(bucketDurationMs(0)).toBe("lt-100ms");
    expect(bucketDurationMs(99)).toBe("lt-100ms");
    expect(bucketDurationMs(100)).toBe("100-500ms");
    expect(bucketDurationMs(4_999)).toBe("1-5s");
    expect(bucketDurationMs(5_000)).toBe("gt-5s");
    expect(bucketDurationMs(Number.NaN)).toBe("lt-100ms");

    expect(bucketInputBytes(0)).toBe("0-100kb");
    expect(bucketInputBytes(100 * 1024)).toBe("100kb-1mb");
    expect(bucketInputBytes(26 * 1024 * 1024)).toBe("gt-10mb"); // above the 25MB upload cap
    expect(bucketInputBytes(-5)).toBe("0-100kb");

    expect(bucketPageCount(1)).toBe("1");
    expect(bucketPageCount(5)).toBe("2-5");
    expect(bucketPageCount(20)).toBe("6-20");
    expect(bucketPageCount(50)).toBe("21-60"); // the live page limit
    expect(bucketPageCount(61)).toBe("gt-60");
    expect(bucketPageCount(undefined)).toBe("unknown");
  });

  it("kill switch: enabled by default, disabled only by explicit off values", () => {
    expect(isPdfTextDiagnosticsEnabled({})).toBe(true);
    expect(isPdfTextDiagnosticsEnabled({ [DIAG_ENV]: "on" })).toBe(true);
    for (const value of ["off", "0", "false", "disabled", "OFF", " off "]) {
      expect(isPdfTextDiagnosticsEnabled({ [DIAG_ENV]: value })).toBe(false);
    }
    // Fail-open: an unrecognized value keeps measuring (unlike the engine
    // gate, which fails closed — diagnostics cannot change behavior).
    expect(isPdfTextDiagnosticsEnabled({ [DIAG_ENV]: "bogus" })).toBe(true);
  });
});

describe("telemetry correctness", () => {
  it("a successful pdfium extraction records success with quality and page facts", async () => {
    const bytes = await makePdf(["phase74-anchor-text"]);
    const result = await runCurrent(bytes);
    expect(result.artifacts).toHaveLength(1);

    const pdfText = pdfTextSnapshot();
    expect(pdfText.byEngine["current-pdfium-text"]).toEqual({
      runs: 1,
      success: 1,
      technicalFailures: 0,
      validationFailures: 0,
    });
    expect(pdfText.qualityStates).toEqual({ healthy: 1 });
    expect(pdfText.validationStatuses).toEqual({ passed: 1 });
    expect(pdfText.pageCountBuckets).toEqual({ "1": 1 });
    expect(pdfText.inputSizeBuckets["0-100kb"]).toBe(1);
    expect(pdfText.eligibleRuns).toBe(1);
    expect(pdfText.technicalFailureRate).toBe(0);
    assertClosedVocabulary();
  });

  it("pre-engine rejections (service input validation) create NO engine event", async () => {
    // A file larger than the per-file limit is rejected by the service
    // BEFORE any processor runs: this is a policy/validation rejection,
    // not engine behavior — it must not appear in engine evidence.
    const huge = new Uint8Array(DEFAULT_PROCESSING_LIMITS.maxFileSize + 1);
    const result = await runProcessingJob(
      {
        toolId: "pdf-to-text",
        files: [
          {
            id: "f1",
            name: "huge.pdf",
            size: huge.length,
            mimeType: "application/pdf",
            bytes: huge,
          },
        ],
        options: { pages: "all" },
      },
      { limits: DEFAULT_PROCESSING_LIMITS },
    );
    expect(result.status).toBe("failed");
    expect(pdfTextSnapshot().byEngine).toEqual({});
    expect(pdfTextSnapshot().eligibleRuns).toBe(0);
  });

  it("a pdfium typed failure records a technical failure with its code", async () => {
    const error = await runCurrent(makeBrokenPdf()).catch((cause) => cause);
    expect(error.code).toBe("INVALID_PDF");

    const pdfText = pdfTextSnapshot();
    expect(pdfText.byEngine["current-pdfium-text"]).toEqual({
      runs: 1,
      success: 0,
      technicalFailures: 1,
      validationFailures: 0,
    });
    expect(pdfText.failureCodes).toEqual({ invalid_pdf: 1 });
    expect(pdfText.pageCountBuckets).toEqual({ unknown: 1 });
    expect(pdfText.eligibleRuns).toBe(1);
    expect(pdfText.technicalFailureRate).toBe(1);
  });

  it("an invalid-options request is a validation failure, excluded from the denominator", async () => {
    const bytes = await makePdf(["phase74-anchor-text"]);
    const error = await runCurrent(bytes, { pages: "bogus" }).catch((cause) => cause);
    expect(error.code).toBe("VALIDATION_ERROR");

    const pdfText = pdfTextSnapshot();
    expect(pdfText.byEngine["current-pdfium-text"].validationFailures).toBe(1);
    expect(pdfText.eligibleRuns).toBe(0); // §9: not an eligible attempt
    expect(pdfText.technicalFailureRate).toBe(null);
  });

  it("the denominator is exactly successes + technical failures (§9)", async () => {
    await runCurrent(await makePdf(["a"])); // success
    await runCurrent(await makePdf(["b"])); // success
    await runCurrent(makeBrokenPdf()).catch(() => undefined); // technical
    await runCurrent(await makePdf(["c"]), { pages: "bogus" }).catch(() => undefined); // validation

    const pdfText = pdfTextSnapshot();
    expect(pdfText.eligibleRuns).toBe(3);
    expect(pdfText.technicalFailureRate).toBeCloseTo(1 / 3, 10);
  });

  it("a manually selected pdfjs run records its own engine id", async () => {
    process.env[ENGINE_ENV] = "pdfjs";
    const engine = selectEngine("pdf-to-text", { honorConfiguredAlternative: true });
    expect(engine.descriptor.id).toBe("pdfjs-text");

    const bytes = await makePdf(["phase74-pdfjs-anchor"]);
    const result = await engine.run(pdfRequest(bytes), { limits: DEFAULT_PROCESSING_LIMITS });
    expect(result.engineId).toBe("pdfjs-text");

    const pdfText = pdfTextSnapshot();
    expect(pdfText.byEngine["pdfjs-text"]).toEqual({
      runs: 1,
      success: 1,
      technicalFailures: 0,
      validationFailures: 0,
    });
    expect(pdfText.byEngine["current-pdfium-text"]).toBeUndefined();
  });

  it("a pdfjs failure records a typed technical failure under its engine id", async () => {
    const error = await pdfjsTextEngine
      .run(pdfRequest(makeBrokenPdf()), { limits: DEFAULT_PROCESSING_LIMITS })
      .catch((cause) => cause);
    expect(error.code).toBe("INVALID_PDF");

    const pdfText = pdfTextSnapshot();
    expect(pdfText.byEngine["pdfjs-text"].technicalFailures).toBe(1);
    expect(pdfText.failureCodes).toEqual({ invalid_pdf: 1 });
  });

  it("a raw internal error maps to the bounded INTERNAL_ERROR label, never the message", async () => {
    const engine = processorEngineAdapter({
      descriptor: {
        id: "test-throwing-engine",
        name: "Test throwing engine",
        conversionType: "pdf-to-text",
        toolId: "pdf-to-text",
        capabilities: [],
        executionClass: "in-process",
        costClass: "local",
        license: "test",
        version: "0.0.1",
        available: true,
      },
      processor: {
        toolId: "pdf-to-text",
        input: currentPdfToTextEngine.input,
        async process() {
          throw new Error(
            "SECRET phase74-raw-exception-message \nfake=log-injection attempt",
          );
        },
      },
    });

    const error = await engine
      .run(pdfRequest(makeBrokenPdf()), { limits: DEFAULT_PROCESSING_LIMITS })
      .catch((cause) => cause);
    expect(error).toBeInstanceOf(Error);

    const pdfText = pdfTextSnapshot();
    expect(pdfText.byEngine["test-throwing-engine"].technicalFailures).toBe(1);
    expect(pdfText.failureCodes).toEqual({ internal_error: 1 });
    // Neither the message nor the injection attempt exists anywhere.
    expect(snapshotJson()).not.toContain("phase74-raw-exception-message");
    expect(snapshotJson()).not.toContain("fake=log-injection");
    assertClosedVocabulary();
  });

  it("non pdf-to-text conversions record nothing", async () => {
    // The pdf-to-word adapter runs through the same factory; only the
    // pdf-to-text conversion type is in diagnostic scope.
    const { currentPdfToWordEngine } = await import("@/lib/engines/adapters/current");
    await currentPdfToWordEngine
      .run(
        {
          toolId: "pdf-to-word",
          files: [
            {
              id: "f1",
              name: "doc.pdf",
              size: (await makePdf(["x"])).length,
              mimeType: "application/pdf",
              bytes: await makePdf(["x"]),
            },
          ],
          options: {},
        },
        { limits: DEFAULT_PROCESSING_LIMITS },
      )
      .catch(() => undefined);
    expect(pdfTextSnapshot().eligibleRuns).toBe(0);
    expect(pdfTextSnapshot().byEngine).toEqual({});
  });
});

describe("privacy (§5)", () => {
  it("no document content, filename or PDF metadata ever enters the snapshot", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const document = await PDFDocument.create();
    document.setTitle("Phase74 Secret Title");
    document.setAuthor("phase74-author-marker");
    document.setKeywords(["phase74-keyword-marker"]);
    const page = document.addPage([400, 300]);
    page.drawText("Priya Raman priya.raman@example.org +91 98765 43210 phase74-invoice-90210", {
      size: 8,
    });
    const bytes = new Uint8Array(await document.save());

    const result = await runCurrent(bytes, { pages: "all" }, "Phase74-Secret-Filename.pdf");
    expect(result.artifacts).toHaveLength(1);

    const json = snapshotJson();
    for (const token of PRIVACY_TOKENS) {
      expect(json, `privacy token "${token}" leaked into telemetry`).not.toContain(token);
    }
    // No raw byte counts / durations either — buckets only.
    expect(json).not.toContain(`"inputBytes"`);
    expect(json).not.toContain(`"durationMs"`);
    assertClosedVocabulary();
  });

  it("a failure path leaks nothing either", async () => {
    // A broken PDF whose bytes CONTAIN privacy tokens (they are parsed, then
    // rejected — the failure path must not echo any of it).
    const bytes = new Uint8Array(
      Buffer.from(`%PDF-1.4 priya.raman@example.org phase74-invoice-90210`),
    );
    await runCurrent(bytes).catch(() => undefined);
    const json = snapshotJson();
    expect(json).not.toContain("priya.raman@example.org");
    expect(json).not.toContain("phase74-invoice-90210");
  });
});

describe("behavior preservation (§6)", () => {
  async function outcomeOf(bytes: Uint8Array, options?: Record<string, unknown>) {
    const result = await runCurrent(bytes, options).catch((cause) => cause);
    if (result instanceof Error || "code" in result === false) {
      return {
        error: { code: (result as ProcessingError).code, message: (result as Error).message },
      };
    }
    return {
      engineId: result.engineId,
      attempt: result.attempt,
      validation: result.validation.status,
      quality: result.quality?.state,
      text: new TextDecoder().decode(result.artifacts[0].bytes),
    };
  }

  it("processing is identical with diagnostics enabled and disabled", async () => {
    const bytes = await makePdf(["phase74-behavior-anchor", "second line"]);
    const successBytes = bytes;

    process.env[DIAG_ENV] = "on";
    const enabled = await outcomeOf(successBytes);
    const enabledFailure = await outcomeOf(makeBrokenPdf());

    process.env[DIAG_ENV] = "off";
    resetTelemetry();
    const disabled = await outcomeOf(bytes);
    const disabledFailure = await outcomeOf(makeBrokenPdf());

    expect(disabled).toEqual(enabled);
    expect(disabledFailure).toEqual(enabledFailure);
    // And with the kill switch on, nothing was recorded.
    expect(pdfTextSnapshot().byEngine).toEqual({});
  });

  it("a throwing telemetry provider never breaks or alters processing", async () => {
    const exploding: MetricsProvider = {
      name: "exploding",
      record() {
        throw new Error("telemetry sink exploded");
      },
      snapshot() {
        throw new Error("snapshot exploded");
      },
      reset() {
        throw new Error("reset exploded");
      },
    };
    setMetricsProviderForTests(exploding);

    const bytes = await makePdf(["phase74-exploding-sink-anchor"]);
    const result = await runCurrent(bytes);
    expect(result.artifacts).toHaveLength(1);
    expect(new TextDecoder().decode(result.artifacts[0].bytes)).toContain(
      "phase74-exploding-sink-anchor",
    );

    const failure = await runCurrent(makeBrokenPdf()).catch((cause) => cause);
    expect(failure.code).toBe("INVALID_PDF"); // identical typed failure
  });

  it("recordTelemetryEvent itself never throws on hostile events", () => {
    expect(() =>
      recordTelemetryEvent({
        type: "pdf_text_engine_run",
        engineId: "x".repeat(500),
        outcome: "success",
        durationBucket: "not a valid bucket \n injection",
        inputSizeBucket: "0-100kb",
        pageCountBucket: "1",
      }),
    ).not.toThrow();
    // Hostile labels fold into closed-vocabulary keys, never raw strings.
    assertClosedVocabulary();
  });
});

describe("QualityGate isolation (§13)", () => {
  it("healthy and suspicious verdicts never alter engine selection", async () => {
    const healthy = await makePdf(["phase74-qg-healthy-text"]);
    const { PDFDocument } = await import("pdf-lib");
    const blank = await PDFDocument.create();
    blank.addPage([300, 300]);
    const suspicious = new Uint8Array(await blank.save());

    for (const [bytes, expectedState] of [
      [healthy, "healthy"],
      [suspicious, "suspicious"],
    ] as const) {
      const result = await runCurrent(bytes);
      expect(result.quality?.state).toBe(expectedState);
      // Default mode: the current engine remains selected, before and after.
      expect(selectEngine("pdf-to-text").descriptor.id).toBe("current-pdfium-text");
      expect(
        selectEngine("pdf-to-text", { honorConfiguredAlternative: true }).descriptor.id,
      ).toBe("current-pdfium-text");
      // Gated mode: the alternative remains selected, verdict notwithstanding.
      process.env[ENGINE_ENV] = "pdfjs";
      expect(
        selectEngine("pdf-to-text", { honorConfiguredAlternative: true }).descriptor.id,
      ).toBe("pdfjs-text");
      delete process.env[ENGINE_ENV];
    }
  });

  it("no engine-selection module references quality verdicts (structural)", () => {
    const selectionSources = [
      "src/lib/engines/router.ts",
      "src/lib/engines/engine-config.ts",
      "src/lib/engines/processor.ts",
    ];
    for (const file of selectionSources) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      for (const state of ["healthy", "suspicious", "insufficient", "not-evaluated"]) {
        expect(source, `${file} must not reference the quality state "${state}"`).not.toContain(
          `"${state}"`,
        );
      }
    }
    // And the diagnostics module (the only quality consumer added in
    // Phase 74) never touches engine selection.
    const diagnostics = readFileSync(
      join(process.cwd(), "src/lib/engines/pdf-text-diagnostics.ts"),
      "utf8",
    );
    expect(diagnostics).not.toContain("selectEngine");
    expect(diagnostics).not.toContain("resolveConfiguredAlternativeEngine");
  });
});

describe("engine isolation and gate preservation (§10, Phase 73 gate)", () => {
  it("pdfium failure in default mode NEVER invokes pdfjs", async () => {
    const pdfjsSpy = vi.spyOn(pdfjsTextEngine, "run");
    const result = await runProcessingJob(
      {
        toolId: "pdf-to-text",
        files: [
          {
            id: "f1",
            name: "broken.pdf",
            size: makeBrokenPdf().length,
            mimeType: "application/pdf",
            bytes: makeBrokenPdf(),
          },
        ],
        options: { pages: "all" },
      },
      { limits: DEFAULT_PROCESSING_LIMITS },
    );

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.code).toBe("INVALID_PDF");
    }
    expect(pdfjsSpy).not.toHaveBeenCalled(); // exactly one attempt, one engine
    // The failure was still recorded as evidence.
    expect(pdfTextSnapshot().byEngine["current-pdfium-text"].technicalFailures).toBe(1);
  });

  it("hostile gate values still select the current engine; only pdfjs selects pdfjs", () => {
    const registry = getDefaultEngineRegistry();
    // NOTE: "PDFJS" (uppercase) and " pdfjs " DO select the alternative —
    // trim+lowercase normalization is intended, documented Phase 73
    // behavior (engine-config.test.ts covers it); only non-matching values
    // fail closed.
    for (const value of [undefined, "", "false", "0", "random", "pdfjs-text", "pd fjs"]) {
      const engine = resolveConfiguredAlternativeEngine("pdf-to-text", registry, {
        [ENGINE_ENV]: value,
      });
      expect(engine, `env "${value}" must not select an alternative`).toBeUndefined();
      expect(
        selectEngine("pdf-to-text", { honorConfiguredAlternative: true }).descriptor.id,
      ).toBe("current-pdfium-text");
    }
    process.env[ENGINE_ENV] = "pdfjs";
    expect(
      resolveConfiguredAlternativeEngine("pdf-to-text", registry, process.env)?.descriptor.id,
    ).toBe("pdfjs-text");
  });
});

describe("security (§16)", () => {
  it("repeated failures stay bounded: fixed keys, no event store", async () => {
    for (let index = 0; index < 12; index += 1) {
      await runCurrent(makeBrokenPdf()).catch(() => undefined);
    }
    const pdfText = pdfTextSnapshot();
    expect(pdfText.byEngine["current-pdfium-text"].runs).toBe(12);
    expect(Object.keys(pdfText.failureCodes)).toEqual(["invalid_pdf"]);
    // The whole snapshot stays small — no per-event accumulation.
    expect(snapshotJson().length).toBeLessThan(8_000);
    assertClosedVocabulary();
  });

  it("diagnostics are recorded in-process only — no client surface imports them", () => {
    // §8: scan client-facing roots (pages/components, excluding server API
    // routes) for any import of the diagnostics or the telemetry facade.
    const clientRoots = ["src/components"];
    const offenders: string[] = [];
    const visit = (directory: string) => {
      for (const entry of readdirSync(join(process.cwd(), directory))) {
        const path = join(directory, entry);
        const full = join(process.cwd(), path);
        if (statSync(full).isDirectory()) {
          visit(path);
          continue;
        }
        if (!path.endsWith(".tsx") && !path.endsWith(".ts")) continue;
        const source = readFileSync(full, "utf8");
        if (
          source.includes("@/lib/engines/pdf-text-diagnostics") ||
          source.includes("@/lib/monitoring/telemetry")
        ) {
          offenders.push(path);
        }
      }
    };
    for (const root of clientRoots) visit(root);
    // src/app pages (client bundles) but NOT src/app/api (server routes):
    // every direct page/layout file plus every non-api subdirectory.
    const appRoot = join(process.cwd(), "src/app");
    for (const entry of readdirSync(appRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name !== "api") visit(`src/app/${entry.name}`);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        const source = readFileSync(join(appRoot, entry.name), "utf8");
        if (
          source.includes("@/lib/engines/pdf-text-diagnostics") ||
          source.includes("@/lib/monitoring/telemetry")
        ) {
          offenders.push(`src/app/${entry.name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
