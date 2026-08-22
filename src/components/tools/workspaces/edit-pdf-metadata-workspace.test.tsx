import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditPdfMetadataWorkspace } from "@/components/tools/workspaces/edit-pdf-metadata-workspace";
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
      <EditPdfMetadataWorkspace limits={LIMITS} />
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

function inspectResponse(overrides: Record<string, unknown> = {}) {
  return fakeResponse({
    headers: { "content-type": "application/json" },
    json: {
      fileName: "document.pdf",
      size: 4096,
      pageCount: 6,
      metadata: {
        title: "Old Title",
        author: "Old Author",
        subject: null,
        keywords: ["old", "stale"],
        creator: "Old Creator",
        producer: "pdf-lib (https://github.com/Hopding/pdf-lib)",
        creationDate: "2026-08-21T23:24:50.000Z",
        modificationDate: "2026-08-21T23:24:50.000Z",
        ...overrides,
      },
    },
  });
}

function savedResponse() {
  return fakeResponse({
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="document-metadata.pdf"',
      "x-pdfkit-pages": "6",
      "x-pdfkit-artifacts": "1",
    },
    blob: new Blob(["%PDF-"], { type: "application/pdf" }),
  });
}

function errorResponse(status: number, code: string, message: string) {
  return fakeResponse({
    ok: false,
    status,
    headers: { "content-type": "application/json" },
    json: { error: { code, message } },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

function editCalls() {
  return fetchMock.mock.calls.filter(
    (call) => call[0] === "/api/tools/edit-pdf-metadata",
  );
}

async function upload(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText(/upload a pdf/i), pdfFile());
  await screen.findByDisplayValue("Old Title");
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/api/documents/inspect")) return inspectResponse();
    if (url.includes("/api/tools/edit-pdf-metadata")) return savedResponse();
    throw new Error(`Unexpected fetch: ${url}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EditPdfMetadataWorkspace", () => {
  it("starts with an upload prompt and a disabled action", () => {
    renderWorkspace();
    expect(screen.getByLabelText(/upload a pdf/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save metadata/i })).toBeDisabled();
    expect(screen.getByText(/upload a pdf to get started/i)).toBeInTheDocument();
  });

  it("shows file facts and the server-read metadata", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    expect(
      screen.getByText("document.pdf", { selector: "span" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === "6 pages"),
    ).toBeInTheDocument();

    // Editable fields are prefilled from the server's readout; absent → empty.
    expect(screen.getByLabelText(/title/i)).toHaveValue("Old Title");
    expect(screen.getByLabelText(/author/i)).toHaveValue("Old Author");
    expect(screen.getByLabelText(/subject/i)).toHaveValue("");
    expect(screen.getByLabelText(/keywords/i)).toHaveValue("old, stale");
    expect(screen.getByLabelText(/creator/i)).toHaveValue("Old Creator");

    // Read-only properties are displayed, not editable inputs.
    expect(screen.getByText("Read-only properties")).toBeInTheDocument();
    // The producer value (only the <dd> carries the full string).
    expect(screen.getByText(/pdf-lib \(https/)).toBeInTheDocument();
    // Creation and modification dates both render formatted.
    expect(screen.getAllByText(/2026-08-21 23:24 UTC/)).toHaveLength(2);
    expect(screen.getByText(/re-stamps the producer/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /save metadata/i }),
    ).toBeEnabled();
  });

  it("edits fields and sends every field explicitly", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    await user.clear(screen.getByLabelText(/title/i));
    await user.type(screen.getByLabelText(/title/i), "New Title");
    await user.clear(screen.getByLabelText(/subject/i));
    await user.type(screen.getByLabelText(/subject/i), "Fresh Subject");

    await user.click(screen.getByRole("button", { name: /save metadata/i }));
    await screen.findByRole("heading", { name: /metadata saved/i });

    expect(editCalls()).toHaveLength(1);
    const form = editCalls()[0][1].body as FormData;
    expect(form.get("title")).toBe("New Title");
    expect(form.get("subject")).toBe("Fresh Subject");
    // Unchanged fields are sent too, so clearing works via the same contract.
    expect(form.get("author")).toBe("Old Author");
    expect(form.get("keywords")).toBe("old, stale");
    expect(form.get("creator")).toBe("Old Creator");
  });

  it("clears all editable fields in one action", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    await user.click(screen.getByRole("button", { name: /clear all fields/i }));
    for (const label of [/title/i, /author/i, /subject/i, /keywords/i, /creator/i]) {
      expect(screen.getByLabelText(label)).toHaveValue("");
    }

    await user.click(screen.getByRole("button", { name: /save metadata/i }));
    await screen.findByRole("heading", { name: /metadata saved/i });
    const form = editCalls()[0][1].body as FormData;
    // Empty strings mean "remove" on the server.
    expect(form.get("title")).toBe("");
    expect(form.get("keywords")).toBe("");
  });

  it("disables editing while processing and offers cancel", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    let resolveSave: (response: Response) => void;
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse();
      return new Promise<Response>((resolve) => (resolveSave = resolve));
    });

    await user.click(screen.getByRole("button", { name: /save metadata/i }));
    expect(screen.getByLabelText(/title/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /saving metadata…/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeEnabled();
    // No fake progress anywhere.
    expect(document.querySelector("progress")).toBeNull();

    resolveSave!(savedResponse());
    await screen.findByRole("heading", { name: /metadata saved/i });
  });

  it("cancels the browser request via AbortController", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse();
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }) as unknown as Promise<Response>;
    });

    await user.click(screen.getByRole("button", { name: /save metadata/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    const init = editCalls()[0][1] as RequestInit & { signal?: AbortSignal };
    expect(init.signal?.aborted).toBe(true);
    expect(
      await screen.findByRole("button", { name: /save metadata/i }),
    ).toBeEnabled();
  });

  it("renders the success state with download and reset", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);
    await user.click(screen.getByRole("button", { name: /save metadata/i }));

    expect(
      await screen.findByRole("heading", { name: /metadata saved/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/unchanged/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /download pdf/i }),
    ).toHaveAttribute("href");
    expect(
      screen.getByRole("button", { name: /edit another pdf/i }),
    ).toBeEnabled();
  });

  it("surfaces a server error as an alert and keeps the draft", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);
    await user.clear(screen.getByLabelText(/title/i));
    await user.type(screen.getByLabelText(/title/i), "Attempted");

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse();
      return errorResponse(400, "VALIDATION_ERROR", "The title must be 2000 characters or fewer.");
    });

    await user.click(screen.getByRole("button", { name: /save metadata/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/2000 characters or fewer/i);
    expect(screen.getByLabelText(/title/i)).toHaveValue("Attempted");
  });

  it("distinguishes an unreadable PDF from a network failure", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) {
        return errorResponse(422, "INVALID_PDF", "A PDF could not be opened.");
      }
      throw new Error("unexpected");
    });
    await user.upload(screen.getByLabelText(/upload a pdf/i), pdfFile());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not be opened/i,
    );
  });

  it("reports a network failure without pretending to succeed", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse();
      throw new TypeError("Failed to fetch");
    });

    await user.click(screen.getByRole("button", { name: /save metadata/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/check your connection/i);
  });

  it("resets everything with start over", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);
    await user.click(screen.getByRole("button", { name: /save metadata/i }));
    await screen.findByRole("heading", { name: /metadata saved/i });

    await user.click(screen.getByRole("button", { name: /start over/i }));
    expect(screen.getByText(/upload a pdf to get started/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/title/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save metadata/i })).toBeDisabled();
  });

  it("announces states politely for screen readers", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    expect(screen.getByRole("status")).toHaveTextContent(
      /properties loaded/i,
    );

    await user.click(screen.getByRole("button", { name: /save metadata/i }));
    await screen.findByRole("heading", { name: /metadata saved/i });
    expect(screen.getByRole("status")).toHaveTextContent(/ready to download/i);
  });
});
