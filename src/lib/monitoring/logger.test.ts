import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logStructuredJob } from "@/lib/monitoring/logger";

describe("logStructuredJob", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("emits plain text log entry in development mode", () => {
    vi.stubEnv("NODE_ENV", "development");
    logStructuredJob({
      toolId: "merge-pdf",
      outcome: "succeeded",
      fileCount: 2,
      totalBytes: 2048,
      durationMs: 15,
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      "[processing] tool=merge-pdf outcome=succeeded files=2 bytes=2048 ms=15",
    );
  });

  it("emits structured JSON entry in production mode", () => {
    vi.stubEnv("NODE_ENV", "production");
    logStructuredJob({
      toolId: "merge-pdf",
      outcome: "succeeded",
      fileCount: 2,
      totalBytes: 2048,
      durationMs: 15,
    });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const raw = consoleSpy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    expect(parsed.event).toBe("job_completed");
    expect(parsed.tool).toBe("merge-pdf");
    expect(parsed.outcome).toBe("succeeded");
    expect(parsed.files).toBe(2);
    expect(parsed.bytes).toBe(2048);
    expect(parsed.ms).toBe(15);
    expect(parsed).not.toHaveProperty("fileName");
    expect(parsed).not.toHaveProperty("password");
  });
});
