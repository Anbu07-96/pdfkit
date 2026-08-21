import { describe, expect, it } from "vitest";
import {
  COMPRESSION_LEVELS,
  compressionStatsFromMeta,
  compressionStatsToMeta,
  computeCompressionStats,
  isCompressionLevel,
} from "@/lib/processing/compression";

describe("compression level model", () => {
  it("accepts exactly low, medium and high", () => {
    for (const level of COMPRESSION_LEVELS) {
      expect(isCompressionLevel(level)).toBe(true);
    }
    expect(COMPRESSION_LEVELS).toEqual(["low", "medium", "high"]);

    for (const bad of ["", "LOW", "ultra", 3, null, undefined, {}, "medium "]) {
      expect(isCompressionLevel(bad)).toBe(false);
    }
  });
});

describe("computeCompressionStats", () => {
  it("computes the example from the specification exactly", () => {
    // 1000 → 750 must report 250 saved and 25.0 %.
    const stats = computeCompressionStats({
      originalBytes: 1000,
      outputBytes: 750,
      compressionLevel: "medium",
      strategy: "lossless",
    });

    expect(stats).toEqual({
      originalBytes: 1000,
      outputBytes: 750,
      bytesSaved: 250,
      reductionPercent: 25,
      wasReduced: true,
      compressionLevel: "medium",
      strategy: "lossless",
    });
  });

  it("rounds the percentage to one decimal", () => {
    const stats = computeCompressionStats({
      originalBytes: 3000,
      outputBytes: 2000,
      compressionLevel: "low",
      strategy: "lossless",
    });
    expect(stats.bytesSaved).toBe(1000);
    expect(stats.reductionPercent).toBe(33.3);
  });

  it("reports zero saving, never a negative one, when nothing shrinks", () => {
    const equal = computeCompressionStats({
      originalBytes: 1200,
      outputBytes: 1200,
      compressionLevel: "medium",
      strategy: "lossless",
    });
    expect(equal.wasReduced).toBe(false);
    expect(equal.bytesSaved).toBe(0);
    expect(equal.reductionPercent).toBe(0);
    // The strategy is rewritten: the returned bytes are the original file.
    expect(equal.strategy).toBe("original");

    const larger = computeCompressionStats({
      originalBytes: 1200,
      outputBytes: 1500,
      compressionLevel: "high",
      strategy: "rasterized",
    });
    expect(larger.wasReduced).toBe(false);
    expect(larger.bytesSaved).toBe(0);
    expect(larger.strategy).toBe("original");
  });

  it("keeps the raster-skip reason when given", () => {
    const stats = computeCompressionStats({
      originalBytes: 100,
      outputBytes: 50,
      compressionLevel: "high",
      strategy: "lossless",
      rasterSkipped: "too-many-pages",
    });
    expect(stats.rasterSkipped).toBe("too-many-pages");
  });

  it("refuses a nonsensical original size", () => {
    expect(() =>
      computeCompressionStats({
        originalBytes: 0,
        outputBytes: 0,
        compressionLevel: "low",
        strategy: "lossless",
      }),
    ).toThrow();
  });
});

describe("compression meta round-trip", () => {
  it("survives the meta record and back", () => {
    const stats = computeCompressionStats({
      originalBytes: 4800,
      outputBytes: 2900,
      compressionLevel: "high",
      strategy: "rasterized",
    });

    const meta = compressionStatsToMeta(stats);
    // The processing contract only carries numbers and strings.
    for (const value of Object.values(meta)) {
      expect(["number", "string"]).toContain(typeof value);
    }

    expect(compressionStatsFromMeta(meta)).toEqual(stats);
  });

  it("returns undefined for meta without compression keys", () => {
    expect(compressionStatsFromMeta(undefined)).toBeUndefined();
    expect(compressionStatsFromMeta({ pages: 3 })).toBeUndefined();
    expect(
      compressionStatsFromMeta({ originalBytes: "big", outputBytes: 1 }),
    ).toBeUndefined();
  });

  it("round-trips a no-reduction result", () => {
    const stats = computeCompressionStats({
      originalBytes: 500,
      outputBytes: 500,
      compressionLevel: "low",
      strategy: "original",
    });
    expect(compressionStatsFromMeta(compressionStatsToMeta(stats))).toEqual(
      stats,
    );
  });
});
