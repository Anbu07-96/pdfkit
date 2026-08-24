import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoveMetadataWorkspace } from "@/components/tools/workspaces/remove-metadata-workspace";
import { ToastProvider } from "@/components/ui/toast";

const LIMITS = { maxFileSize: 25 * 1024 * 1024 };

function pdfFile(name = "document.pdf", size = 4096) {
  const file = new File(["%PDF-1.7"], name, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function renderWorkspace() {
  return render(
    <ToastProvider>
      <RemoveMetadataWorkspace limits={LIMITS} />
    </ToastProvider>,
  );
}

function fakeResponse({
  ok = true,
  status = 200,
  headers = {},
  blob,
  json,
}: {
  ok?: boolean;
  status?: number;
  headers?: Record<string, string>;
  blob?: Blob;
  json?: unknown;
}) {
  return {
    ok,
    status,
    headers: new Headers(headers),
    blob: async () => blob ?? new Blob([]),
    json: async () => json,
  } as unknown as Response;
}

function inspectResponse(metadata: Record<string, unknown>) {
  return fakeResponse({
    headers: { "content-type": "application/json" },
    json: {
      fileName: "document.pdf",
      size: 4096,
      pageCount: 4,
      metadata: {
        title: null,
        author: null,
        subject: null,
        keywords: null,
        creator: null,
        producer: "pdf-lib (https://github.com/Hopding/pdf-lib)",
        creationDate: "2026-08-21T23:24:50.000Z",
        modificationDate: "2026-08-21T23:24:50.000Z",
        xmpPresent: false,
        ...metadata,
      },
    },
  });
}

function removedResponse(fields: number, xmp: "yes" | "not-present" = "yes") {
  return fakeResponse({
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="document-metadata-removed.pdf"',
      "x-pdfkit-pages": "4",
      "x-pdfkit-artifacts": "1",
      "x-pdfkit-removed-fields": String(fields),
      "x-pdfkit-xmp-removed": xmp,
      "x-pdfkit-verification": "verified",
    },
    blob: new Blob(["%PDF-"], { type: "application/pdf" }),
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

function removeCalls() {
  return fetchMock.mock.calls.filter(
    (call) => call[0] === "/api/tools/remove-metadata",
  );
}

async function upload(
  user: ReturnType<typeof userEvent.setup>,
  metadata: Record<string, unknown> = {},
) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/api/documents/inspect")) return inspectResponse(metadata);
    return removedResponse(3);
  });
  await user.upload(screen.getByLabelText(/upload a pdf/i), pdfFile());
  await screen.findByText(/Metadata found in this document/i);
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RemoveMetadataWorkspace", () => {
  it("starts with an upload prompt and a disabled action", () => {
    renderWorkspace();
    expect(screen.getByLabelText(/upload a pdf/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^remove metadata$/i }),
    ).toBeDisabled();
    expect(screen.getByText(/upload a pdf to get started/i)).toBeInTheDocument();
  });

  it("shows the server-detected metadata and the honest explanation", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user, {
      title: "Quarterly Report",
      author: "Deepa",
      keywords: ["finance", "2026"],
      xmpPresent: true,
    });

    // Detected values come from the server readout, dashes for absent ones.
    expect(screen.getByText("Quarterly Report")).toBeInTheDocument();
    expect(screen.getByText("Deepa")).toBeInTheDocument();
    expect(screen.getByText("finance, 2026")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Present")).toBeInTheDocument(); // XMP

    // The explanation states what is removed and what cannot be.
    expect(screen.getByText(/3 of the 5 fields contain data/i)).toBeInTheDocument();
    expect(screen.getByText(/emptied rather than deleted/i)).toBeInTheDocument();
    expect(screen.getByText(/not be completely metadata-free/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^remove metadata$/i }),
    ).toBeEnabled();
  });

  it("sends exactly one file and shows the verified server result", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user, { title: "x" });

    await user.click(screen.getByRole("button", { name: /^remove metadata$/i }));

    expect(
      await screen.findByRole("heading", { name: /metadata removed and verified/i }),
    ).toBeInTheDocument();
    expect(removeCalls()).toHaveLength(1);
    const form = removeCalls()[0][1].body as FormData;
    expect(form.getAll("files")).toHaveLength(1);

    // Server-reported facts: fields removed, XMP removed, pages unchanged.
    expect(screen.getByText(/3 fields removed/i)).toBeInTheDocument();
    expect(screen.getByText(/XMP data removed/i)).toBeInTheDocument();
    expect(screen.getByText(/unchanged/i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/verified by re-reading the result/i).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByRole("link", { name: /download pdf/i }),
    ).toHaveAttribute("href");
    expect(
      screen.getByRole("button", { name: /remove metadata from another pdf/i }),
    ).toBeEnabled();
  });

  it("shows an honest indeterminate processing state", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user, { title: "x" });

    let resolveRemove: (response: Response) => void;
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse({ title: "x" });
      return new Promise<Response>((resolve) => (resolveRemove = resolve));
    });

    await user.click(screen.getByRole("button", { name: /^remove metadata$/i }));
    expect(
      (await screen.findAllByText(/removing metadata…/i)).length,
    ).toBeGreaterThanOrEqual(1);
    expect(document.querySelector("progress")).toBeNull();
    expect(screen.queryByText(/%\s*complete/i)).not.toBeInTheDocument();

    resolveRemove!(removedResponse(1));
    await screen.findByRole("heading", { name: /metadata removed and verified/i });
  });

  it("cancels the browser request via AbortController", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user, { title: "x" });

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse({ title: "x" });
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }) as unknown as Promise<Response>;
    });

    await user.click(screen.getByRole("button", { name: /^remove metadata$/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    const init = removeCalls()[0][1] as RequestInit & { signal?: AbortSignal };
    expect(init.signal?.aborted).toBe(true);
    expect(
      await screen.findByRole("button", { name: /^remove metadata$/i }),
    ).toBeEnabled();
  });

  it("surfaces a server error as an alert", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user, { title: "x" });
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse({ title: "x" });
      return fakeResponse({
        ok: false,
        status: 422,
        json: { error: { code: "INVALID_PDF", message: "A PDF could not be opened." } },
      });
    });

    await user.click(screen.getByRole("button", { name: /^remove metadata$/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not be opened/i);
    expect(alert).toHaveTextContent(/could not be removed/i);
  });

  it("distinguishes network failure from processing failure", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user, { title: "x" });
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse({ title: "x" });
      throw new TypeError("Failed to fetch");
    });

    await user.click(screen.getByRole("button", { name: /^remove metadata$/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/check your connection/i);
  });

  it("resets everything with start over", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user, { title: "x" });
    await user.click(screen.getByRole("button", { name: /^remove metadata$/i }));
    await screen.findByRole("heading", { name: /metadata removed and verified/i });

    await user.click(screen.getByRole("button", { name: /start over/i }));
    expect(screen.getByText(/upload a pdf to get started/i)).toBeInTheDocument();
    expect(screen.queryByText(/Metadata found/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^remove metadata$/i }),
    ).toBeDisabled();
  });

  it("announces states politely for screen readers", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user, { title: "x", author: "y" });

    expect(screen.getByRole("status")).toHaveTextContent(
      /2 of 5 fields contain data/i,
    );

    await user.click(screen.getByRole("button", { name: /^remove metadata$/i }));
    await screen.findByRole("heading", { name: /metadata removed and verified/i });
    expect(screen.getByRole("status")).toHaveTextContent(/ready to download/i);
  });
});
