import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlattenPdfWorkspace } from "@/components/tools/workspaces/flatten-pdf-workspace";
import { ToastProvider } from "@/components/ui/toast";

const LIMITS = { maxFileSize: 25 * 1024 * 1024 };

function pdfFile(name = "form.pdf", size = 4096) {
  const file = new File(["%PDF-1.7"], name, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function renderWorkspace() {
  return render(
    <ToastProvider>
      <FlattenPdfWorkspace limits={LIMITS} />
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

const inspectResponse = (pageCount: number) =>
  fakeResponse({
    headers: { "content-type": "application/json" },
    json: { fileName: "form.pdf", size: 4096, pageCount },
  });

const flattenedResponse = (fields: number, pages: number) =>
  fakeResponse({
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="flattened.pdf"',
      "x-pdfkit-pages": String(pages),
      "x-pdfkit-output-pages": String(pages),
      "x-pdfkit-flattened-fields": String(fields),
      "x-pdfkit-artifacts": "1",
    },
    blob: new Blob(["%PDF-"], { type: "application/pdf" }),
  });

let fetchMock: ReturnType<typeof vi.fn>;

function flattenCalls() {
  return fetchMock.mock.calls.filter((call) => call[0] === "/api/tools/flatten-pdf");
}

async function upload(user: ReturnType<typeof userEvent.setup>) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/api/documents/inspect")) return inspectResponse(3);
    return flattenedResponse(5, 3);
  });
  await user.upload(screen.getByLabelText(/upload a pdf/i), pdfFile());
  await screen.findByText(/flattening is permanent/i);
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:mock"),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FlattenPdfWorkspace", () => {
  it("starts with an upload prompt and a disabled action", () => {
    renderWorkspace();
    expect(screen.getByLabelText(/upload a pdf/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^flatten pdf$/i })).toBeDisabled();
    expect(screen.getByText(/upload a pdf to get started/i)).toBeInTheDocument();
  });

  it("shows the page count and every honesty statement after upload", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    expect(screen.getByText("form.pdf", { selector: "span" })).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === "3 pages"),
    ).toBeInTheDocument();

    // The irreversibility warning is prominent and explicit.
    expect(
      screen.getByText(/flattening is permanent — form fields stop being editable/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();

    // Text stays selectable; links keep working.
    expect(screen.getByText(/text remains selectable/i)).toBeInTheDocument();
    expect(screen.getByText(/remain clickable/i)).toBeInTheDocument();

    // Scripts are NOT removed — stated before processing.
    expect(screen.getByText(/document scripts are not removed/i)).toBeInTheDocument();
    expect(
      screen.getByText(/not a sanitisation or security feature/i),
    ).toBeInTheDocument();

    // Signed PDFs are rejected — stated before processing.
    expect(screen.getByText(/signed pdfs are rejected/i)).toBeInTheDocument();
    expect(screen.getByText(/invalidate a digital\s+signature/i)).toBeInTheDocument();
  });

  it("announces readiness politely for screen readers", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent(/pdf loaded with 3 pages/i);
  });

  it("flattens and reports the server-confirmed field count", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    await user.click(screen.getByRole("button", { name: /^flatten pdf$/i }));

    expect(
      await screen.findByRole("heading", { name: /form flattened and verified/i }),
    ).toBeInTheDocument();
    // The count comes from the response header, never a client guess. It is
    // shown in both the success panel and the toast.
    expect(screen.getAllByText(/5\s+fields\s+flattened/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /download pdf/i })).toHaveAttribute(
      "download",
      "flattened.pdf",
    );
    // Success copy repeats the honesty statements.
    expect(screen.getByText(/scripts were/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone in this file/i)).toBeInTheDocument();

    // Screen-reader announcement of the verified result.
    expect(screen.getByRole("status")).toHaveTextContent(
      /form flattened and verified\. 5 fields became permanent page content/i,
    );

    expect(flattenCalls()).toHaveLength(1);
  });

  it("shows an indeterminate processing state without fake percentages", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/api/documents/inspect")) {
        return Promise.resolve(inspectResponse(3));
      }
      return new Promise<Response>(() => {}) as unknown as Promise<Response>;
    });

    await user.click(screen.getByRole("button", { name: /^flatten pdf$/i }));

    expect(await screen.findByText(/flattening form fields…/i)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/flattening the form fields/i);
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("cancels the browser request via AbortController", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/api/documents/inspect")) {
        return Promise.resolve(inspectResponse(3));
      }
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }) as unknown as Promise<Response>;
    });

    await user.click(screen.getByRole("button", { name: /^flatten pdf$/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    const init = flattenCalls()[0][1] as RequestInit & { signal?: AbortSignal };
    expect(init.signal?.aborted).toBe(true);
    expect(
      await screen.findByRole("button", { name: /^flatten pdf$/i }),
    ).toBeEnabled();
    // No error is shown for a user-initiated cancel.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces the SIGNED_PDF rejection as an alert", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse(3);
      return fakeResponse({
        ok: false,
        status: 422,
        json: {
          error: {
            code: "SIGNED_PDF",
            message: "This PDF contains a digital signature and cannot be flattened.",
            details: [
              "Flattening rewrites the PDF, which would invalidate the signature.",
            ],
          },
        },
      });
    });

    await user.click(screen.getByRole("button", { name: /^flatten pdf$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/digital signature/i);
    expect(alert).toHaveTextContent(/invalidate the signature/i);
    expect(screen.getByRole("status")).toHaveTextContent(/flattening failed/i);
  });

  it("surfaces other server errors as an alert", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse(3);
      return fakeResponse({
        ok: false,
        status: 422,
        json: { error: { code: "INVALID_PDF", message: "A PDF could not be opened." } },
      });
    });

    await user.click(screen.getByRole("button", { name: /^flatten pdf$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not be opened/i);
    expect(alert).toHaveTextContent(/could not be flattened/i);
  });

  it("rejects a non-PDF upload before any request is made", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderWorkspace();

    const bad = new File(["not a pdf"], "image.png", { type: "image/png" });
    await user.upload(screen.getByLabelText(/upload a pdf/i), bad);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /is not a supported file type/i,
      );
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resets everything with Start over", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    await user.click(screen.getByRole("button", { name: /^flatten pdf$/i }));
    await screen.findByRole("heading", { name: /form flattened and verified/i });

    await user.click(screen.getByRole("button", { name: /flatten another pdf/i }));

    expect(
      screen.queryByRole("heading", { name: /form flattened and verified/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/flattening is permanent/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^flatten pdf$/i })).toBeDisabled();
    expect(screen.getByText(/upload a pdf to get started/i)).toBeInTheDocument();
  });
});
