// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Server-only boundary guard.
 *
 * `import "server-only"` already makes `next build` fail if a client component
 * pulls in the processing or rasterising layers, but that only fires when the
 * build runs. This test states the rule directly and fails in milliseconds.
 */

const SRC = join(process.cwd(), "src");

/** Modules that must never be reachable from browser code. */
const SERVER_ONLY_IMPORTS = [
  "pdf-lib",
  "@hyzyla/pdfium",
  "jpeg-js",
  "docx",
  "fflate",
  "@/lib/processing/processors/",
  "@/lib/processing/optimize/",
  "@/lib/processing/service",
  "@/lib/processing/http",
  "@/lib/processing/registry",
  "@/lib/processing/inspect",
  "@/lib/processing/limits",
  "@/lib/processing/contract",
  "@/lib/thumbnails/renderer",
  "@/lib/thumbnails/service",
  "@/lib/thumbnails/limits",
  "@/lib/thumbnails/png",
];

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}

const files = walk(SRC).filter((path) => !path.includes(".test."));

/** Files that opt into the browser with the "use client" directive. */
const clientFiles = files.filter((path) => {
  const source = readFileSync(path, "utf8");
  return /^\s*["']use client["']/.test(source);
});

describe("server-only boundary", () => {
  it("finds the client components", () => {
    // Sanity check: if this ever hits zero the test below proves nothing.
    expect(clientFiles.length).toBeGreaterThan(10);
  });

  it("keeps PDF processing out of client components", () => {
    const violations: string[] = [];

    for (const path of clientFiles) {
      const source = readFileSync(path, "utf8");
      for (const forbidden of SERVER_ONLY_IMPORTS) {
        // Type-only imports are erased at build time and are safe.
        const pattern = new RegExp(
          `import\\s+(?!type\\s)[^;]*from\\s+["']${forbidden.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")}`,
        );
        if (pattern.test(source)) {
          violations.push(`${path.replace(SRC, "src")} imports ${forbidden}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("marks every processing and thumbnail module server-only", () => {
    const serverModules = files.filter(
      (path) =>
        (path.includes("/lib/processing/") || path.includes("/lib/thumbnails/")) &&
        !path.endsWith("pages.ts") &&
        !path.endsWith("compression.ts") &&
        !path.endsWith("watermark.ts") &&
        !path.endsWith("page-numbers.ts") &&
        !path.endsWith("metadata.ts") &&
        !path.endsWith("errors.ts") &&
        !path.endsWith("rules.ts") &&
        !path.endsWith("client.ts") &&
        !path.endsWith("types.ts") &&
        !path.endsWith("png.ts") &&
        !path.endsWith("rotate-pixels.ts") &&
        !path.endsWith("file-names.ts"),
    );

    expect(serverModules.length).toBeGreaterThan(5);

    for (const path of serverModules) {
      const source = readFileSync(path, "utf8");
      expect(source, `${path.replace(SRC, "src")} is missing server-only`).toContain(
        'import "server-only"',
      );
    }
  });
});
