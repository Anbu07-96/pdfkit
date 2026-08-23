import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageNumbersWorkspace } from "@/components/tools/workspaces/page-numbers-workspace";
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
      <PageNumbersWorkspace limits={LIMITS} />
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
    json: { fileName: "document.pdf", size: 4096, pageCount },
  });

const numberedResponse = (numbered: number, pages: number) =>
  fakeResponse({
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="document-numbered.pdf"',
      "x-pdfkit-pages": String(pages),
      "x-pdfkit-output-pages": String(pages),
      "x-pdfkit-numbered-pages": String(numbered),
      "x-pdfkit-artifacts": "1",
    },
    blob: new Blob(["%PDF-"], { type: "application/pdf" }),
  });

let fetchMock: ReturnType<typeof vi.fn>;

function calls() {
  return fetchMock.mock.calls.filter(
    (call) => call[0] === "/api/tools/page-numbers",
  );
}

async function upload(user: ReturnType<typeof userEvent.setup>) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/api/documents/inspect")) return inspectResponse(6);
    return numberedResponse(6, 6);
  });
  await user.upload(screen.getByLabelText(/upload a pdf/i), pdfFile());
  await screen.findByText(/choose the numbering options/i);
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PageNumbersWorkspace", () => {
  it("starts with an upload prompt, a disabled action and no options", () => {
    renderWorkspace();
    expect(screen.getByLabelText(/upload a pdf/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^add page numbers$/i }),
    ).toBeDisabled();
    expect(screen.queryByLabelText(/starting number/i)).not.toBeInTheDocument();
  });

  it("shows the page count, defaults and the what-gets-added explanation", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    expect(screen.getByText("document.pdf", { selector: "span" })).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === "6 pages"),
    ).toBeInTheDocument();

    // Defaults: bottom-center, start 1, size 11, "Page 1 of 10", all pages.
    expect(screen.getByRole("radio", { name: /^Bottom center/i })).toBeChecked();
    expect(screen.getByLabelText(/starting number/i)).toHaveValue("1");
    expect(screen.getByLabelText(/font size/i)).toHaveValue("11");
    expect(screen.getByRole("radio", { name: /Page 1 of 10/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^All pages/i })).toBeChecked();

    // The explanation states the real page count and that text is added.
    expect(screen.getByRole("heading", { name: /what gets added/i })).toBeInTheDocument();
    expect(screen.getByText(/ordinary visible text/i)).toBeInTheDocument();
    expect(screen.getAllByText(/real page count/i).length).toBeGreaterThanOrEqual(2);

    expect(
      screen.getByRole("button", { name: /^add page numbers$/i }),
    ).toBeEnabled();
  });

  it("switches position, format and pages and edits the numbers", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    await user.click(screen.getByRole("radio", { name: /^Bottom right/i }));
    await user.click(
      screen.getByRole("radio", { name: /The word, then the number/i }),
    );
    await user.click(screen.getByRole("radio", { name: /^Last page/i }));
    await user.clear(screen.getByLabelText(/starting number/i));
    await user.type(screen.getByLabelText(/starting number/i), "3");
    await user.clear(screen.getByLabelText(/font size/i));
    await user.type(screen.getByLabelText(/font size/i), "16");

    expect(screen.getByRole("radio", { name: /^Bottom right/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /The word, then the number/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^Last page/i })).toBeChecked();
  });

  it("sends every option to the server", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    await user.click(screen.getByRole("radio", { name: /^Bottom left/i }));
    await user.clear(screen.getByLabelText(/starting number/i));
    await user.type(screen.getByLabelText(/starting number/i), "3");
    await user.clear(screen.getByLabelText(/font size/i));
    await user.type(screen.getByLabelText(/font size/i), "14");
    await user.click(screen.getByRole("radio", { name: /Just the number/i }));
    await user.click(screen.getByRole("radio", { name: /^First page/i }));
    await user.click(screen.getByRole("button", { name: /^add page numbers$/i }));

    await waitFor(() => expect(calls()).toHaveLength(1));
    const form = calls()[0][1].body as FormData;
    expect(form.get("position")).toBe("bottom-left");
    expect(form.get("start")).toBe("3");
    expect(form.get("size")).toBe("14");
    expect(form.get("format")).toBe("number");
    expect(form.get("pages")).toBe("first");
    expect(form.getAll("files")).toHaveLength(1);
  });

  it("disables the action while inputs are invalid and flags aria-invalid", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    const start = screen.getByLabelText(/starting number/i);
    expect(start).toHaveAttribute("aria-invalid", "false");
    await user.clear(start);
    await user.type(start, "0");
    expect(start).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByRole("button", { name: /^add page numbers$/i }),
    ).toBeDisabled();
    expect(screen.getAllByText(/between 1 and 9999/i).length).toBeGreaterThanOrEqual(1);

    await user.clear(start);
    await user.type(start, "2");
    expect(
      screen.getByRole("button", { name: /^add page numbers$/i }),
    ).toBeEnabled();
  });

  it("shows an honest indeterminate processing state and cancels via AbortController", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    fetchMock.mockImplementation(
      (url: string, init?: RequestInit) =>
        url.includes("/api/documents/inspect")
          ? inspectResponse(6)
          : new Promise<Response>((_, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(new DOMException("aborted", "AbortError")),
              );
            }),
    );

    await user.click(screen.getByRole("button", { name: /^add page numbers$/i }));
    expect(
      (await screen.findAllByText(/adding page numbers…/i)).length,
    ).toBeGreaterThanOrEqual(1);
    expect(document.querySelector("progress")).toBeNull();

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    const init = calls()[0][1] as RequestInit & { signal?: AbortSignal };
    expect(init.signal?.aborted).toBe(true);
    expect(
      await screen.findByRole("button", { name: /^add page numbers$/i }),
    ).toBeEnabled();
  });

  it("renders the server-confirmed success state", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse(6);
      return numberedResponse(1, 6);
    });

    await user.click(screen.getByRole("radio", { name: /^Last page/i }));
    await user.click(screen.getByRole("button", { name: /^add page numbers$/i }));

    expect(
      await screen.findByRole("heading", { name: /page numbers added/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/1 of 6/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/searchable PDF/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /download numbered pdf/i }),
    ).toHaveAttribute("href");
    expect(
      screen.getByRole("button", { name: /number another pdf/i }),
    ).toBeEnabled();
  });

  it("surfaces a server error as an alert", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse(6);
      return fakeResponse({
        ok: false,
        status: 400,
        json: {
          error: {
            code: "INVALID_PAGE_NUMBER_CONFIGURATION",
            message: "The starting number must be a whole number between 1 and 9999.",
          },
        },
      });
    });

    await user.click(screen.getByRole("button", { name: /^add page numbers$/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/between 1 and 9999/i);
  });

  it("distinguishes network failure from processing failure", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse(6);
      throw new TypeError("Failed to fetch");
    });

    await user.click(screen.getByRole("button", { name: /^add page numbers$/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/check your connection/i);
  });

  it("resets everything with start over", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);
    await user.click(screen.getByRole("button", { name: /^add page numbers$/i }));
    await screen.findByRole("heading", { name: /page numbers added/i });

    await user.click(screen.getByRole("button", { name: /start over/i }));
    expect(screen.getByText(/upload a pdf to get started/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/starting number/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^add page numbers$/i }),
    ).toBeDisabled();
  });

  it("numbers a second document after a successful one", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);
    await user.click(screen.getByRole("button", { name: /^add page numbers$/i }));
    await screen.findByRole("heading", { name: /page numbers added/i });

    await user.click(screen.getByRole("button", { name: /number another pdf/i }));
    await upload(user);
    await user.click(screen.getByRole("button", { name: /^add page numbers$/i }));

    await waitFor(() => expect(calls()).toHaveLength(2));
    expect(await screen.findByRole("heading", { name: /page numbers added/i }));
  });

  it("announces states politely for screen readers", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    expect(screen.getByRole("status")).toHaveTextContent(/loaded with 6 pages/i);

    await user.click(screen.getByRole("button", { name: /^add page numbers$/i }));
    await screen.findByRole("heading", { name: /page numbers added/i });
    expect(screen.getByRole("status")).toHaveTextContent(/ready to download/i);
  });
});
