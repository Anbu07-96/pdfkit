import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BulkWorkspace } from "@/components/bulk/bulk-workspace";
import { ToastProvider } from "@/components/ui/toast";
import { getBulkOperation } from "@/lib/tools/bulk";

/**
 * Bulk workspace tests. The batch runner and the usage endpoint are mocked:
 * these tests assert the workspace contract — preflight display, disabled
 * states, per-file status reporting and the retry/download affordances.
 */

const operation = getBulkOperation("pdf-to-word")!;

function usageResponse(overrides: Record<string, unknown> = {}) {
  return {
    tier: "free",
    periodDate: "2026-09-08",
    jobsUsed: 3,
    dailyJobLimit: 50,
    jobsRemaining: 47,
    bytesUsed: 10 * 1024 * 1024,
    dailyByteLimit: 250 * 1024 * 1024,
    bytesRemaining: 240 * 1024 * 1024,
    ...overrides,
  };
}

function okFetch() {
  return vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/usage") {
      return new Response(JSON.stringify(usageResponse()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": 'attachment; filename="out.docx"',
      },
    });
  });
}

function renderWorkspace(fetchMock: ReturnType<typeof okFetch>) {
  vi.stubGlobal("fetch", fetchMock);
  return render(
    <ToastProvider>
      <BulkWorkspace operation={operation} limits={{ maxFileSize: 25 * 1024 * 1024 }} />
    </ToastProvider>,
  );
}

describe("BulkWorkspace", () => {
  it("renders the upload zone and disabled start button initially", () => {
    renderWorkspace(okFetch());
    expect(screen.getAllByText(/upload your \.pdf files/i)[0]).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^process 0 files$/i }),
    ).toBeDisabled();
  });

  it("shows the batch's quota need once files are selected", async () => {
    const user = userEvent.setup();
    renderWorkspace(okFetch());

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    await user.upload(input, [
      new File([new Uint8Array(1024)], "one.pdf", { type: "application/pdf" }),
      new File([new Uint8Array(2048)], "two.pdf", { type: "application/pdf" }),
    ]);

    expect(
      await screen.findByText(
        (_, element) =>
          element?.tagName === "P" && element.textContent?.startsWith("2 files selected") === true,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/this batch needs/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^process 2 files$/i })).toBeEnabled();
  });

  it("warns when the batch is larger than the remaining quota", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/usage") {
        return new Response(
          JSON.stringify(usageResponse({ jobsRemaining: 1, bytesRemaining: 1024 })),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(new Uint8Array([1]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ToastProvider>
        <BulkWorkspace operation={operation} limits={{ maxFileSize: 25 * 1024 * 1024 }} />
      </ToastProvider>,
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, [
      new File([new Uint8Array(1024)], "one.pdf", { type: "application/pdf" }),
      new File([new Uint8Array(1024)], "two.pdf", { type: "application/pdf" }),
    ]);

    expect(
      await screen.findByText(/larger than your remaining quota/i),
    ).toBeInTheDocument();
  });

  it("runs the batch and reports per-file results with a download button", async () => {
    const user = userEvent.setup();
    renderWorkspace(okFetch());

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, [
      new File([new Uint8Array(1024)], "one.pdf", { type: "application/pdf" }),
    ]);

    const start = await screen.findByRole("button", { name: /^process 1 file$/i });
    await user.click(start);

    // The file row settles as succeeded and offers an individual download.
    const row = await waitFor(() => {
      const found = document.querySelector('[data-status="succeeded"]');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(row.textContent).toContain("one.pdf");
    expect(screen.getByRole("button", { name: /^download$/i })).toBeInTheDocument();

    // Batch-level affordances appear once the batch is done.
    expect(
      await screen.findByRole("button", { name: /^download all as zip$/i }),
    ).toBeEnabled();
    expect((await screen.findAllByText(/1 succeeded/i)).length).toBeGreaterThan(0);
  });

  it("enables retry when a file fails", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/usage") {
        return new Response(JSON.stringify(usageResponse()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ error: { code: "INVALID_PDF", message: "Not a readable PDF." } }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ToastProvider>
        <BulkWorkspace operation={operation} limits={{ maxFileSize: 25 * 1024 * 1024 }} />
      </ToastProvider>,
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, [
      new File([new Uint8Array(1024)], "bad.pdf", { type: "application/pdf" }),
    ]);

    await user.click(await screen.findByRole("button", { name: /^process 1 file$/i }));

    const failedMatches = await screen.findAllByText(
      (_, element) =>
        element?.tagName === "P" && element.textContent?.includes("1 failed") === true,
    );
    expect(failedMatches.length).toBeGreaterThan(0);
    expect(screen.getByText(/not a readable pdf/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^retry 1 unfinished$/i }),
    ).toBeEnabled();
  });

  it("stops offering a start while a batch is running", async () => {
    const user = userEvent.setup();
    let releaseFetch: (() => void) | undefined;
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/usage") {
        return new Response(JSON.stringify(usageResponse()), {
          status: 200,
          headers: { "content-type": "application/json" } as Record<string, string>,
        });
      }
      await new Promise<void>((resolve) => {
        releaseFetch = resolve;
      });
      return new Response(new Uint8Array([1]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ToastProvider>
        <BulkWorkspace operation={operation} limits={{ maxFileSize: 25 * 1024 * 1024 }} />
      </ToastProvider>,
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, [
      new File([new Uint8Array(1024)], "one.pdf", { type: "application/pdf" }),
    ]);

    await user.click(await screen.findByRole("button", { name: /^process 1 file$/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /^processing batch…$/i }),
      ).toBeDisabled();
    });
    expect(
      screen.getByRole("button", { name: /^cancel batch$/i }),
    ).toBeEnabled();

    releaseFetch?.();
  });
});
