import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddTextWorkspace } from "@/components/tools/workspaces/add-text-workspace";
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
      <AddTextWorkspace limits={LIMITS} />
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

function inspectResponse(pageCount: number) {
  return fakeResponse({
    headers: { "content-type": "application/json" },
    json: { fileName: "document.pdf", size: 4096, pageCount },
  });
}

function textAddedResponse(stamped: number, pages: number) {
  return fakeResponse({
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="document-text-added.pdf"',
      "x-pdfkit-pages": String(pages),
      "x-pdfkit-output-pages": String(pages),
      "x-pdfkit-text-pages": String(stamped),
      "x-pdfkit-artifacts": "1",
    },
    blob: new Blob(["%PDF-"], { type: "application/pdf" }),
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

function addTextCalls() {
  return fetchMock.mock.calls.filter((call) => call[0] === "/api/tools/add-text");
}

async function upload(
  user: ReturnType<typeof userEvent.setup>,
  name = "document.pdf",
) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/api/documents/inspect")) return inspectResponse(4);
    return textAddedResponse(4, 4);
  });
  await user.upload(screen.getByLabelText(/upload a pdf/i), pdfFile(name));
  await screen.findByLabelText(/text to add/i);
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AddTextWorkspace", () => {
  it("starts with an upload prompt, a disabled action and no options", () => {
    renderWorkspace();
    expect(screen.getByLabelText(/upload a pdf/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^add text$/i })).toBeDisabled();
    expect(screen.queryByLabelText(/text to add/i)).not.toBeInTheDocument();
  });

  it("shows the page count, all option groups with defaults and the honest note", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user, "form.pdf");

    expect(screen.getByText("form.pdf", { selector: "span" })).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === "4 pages"),
    ).toBeInTheDocument();

    // Defaults: top left, 16 pt, all pages.
    expect(screen.getByRole("radio", { name: /^top left/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /medium \(16 pt\)/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^all pages/i })).toBeChecked();

    // All nine positions are offered.
    for (const title of [
      "Top left", "Top center", "Top right",
      "Middle left", "Middle center", "Middle right",
      "Bottom left", "Bottom center", "Bottom right",
    ]) {
      expect(screen.getByRole("radio", { name: new RegExp(`^${title}`, "i") })).toBeInTheDocument();
    }

    expect(
      screen.getByRole("heading", { name: /what this adds, honestly/i }),
    ).toBeInTheDocument();

    // No text yet → still disabled.
    expect(screen.getByRole("button", { name: /^add text$/i })).toBeDisabled();
  });

  it("sends every option to the server, including multi-line text", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    await user.type(
      screen.getByLabelText(/text to add/i),
      "Received{enter}Front desk",
    );
    await user.click(screen.getByRole("radio", { name: /^bottom right/i }));
    await user.click(screen.getByRole("radio", { name: /large \(24 pt\)/i }));
    await user.click(screen.getByRole("radio", { name: /^last page/i }));
    await user.click(screen.getByRole("button", { name: /^add text$/i }));

    await waitFor(() => expect(addTextCalls()).toHaveLength(1));
    const form = addTextCalls()[0][1].body as FormData;
    expect(form.get("text")).toBe("Received\nFront desk");
    expect(form.get("placement")).toBe("bottom-right");
    expect(form.get("size")).toBe("24");
    expect(form.get("pages")).toBe("last");
    expect(form.getAll("files")).toHaveLength(1);
  });

  it("renders the server-confirmed success state", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse(4);
      return textAddedResponse(1, 4);
    });

    await user.type(screen.getByLabelText(/text to add/i), "FINAL");
    await user.click(screen.getByRole("radio", { name: /^last page/i }));
    await user.click(screen.getByRole("button", { name: /^add text$/i }));

    expect(
      await screen.findByRole("heading", { name: /^text added$/i }),
    ).toBeInTheDocument();
    // Server-confirmed counts, not client guesses.
    expect(screen.getByText(/1 of 4/i)).toBeInTheDocument();
    expect(screen.getByText(/4 pages, content otherwise unchanged/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /download edited pdf/i }),
    ).toHaveAttribute("href");
    expect(
      screen.getByRole("button", { name: /edit another pdf/i }),
    ).toBeEnabled();
  });

  it("surfaces a server error as an alert and keeps the draft", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);
    await user.type(screen.getByLabelText(/text to add/i), "机密");
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse(4);
      return fakeResponse({
        ok: false,
        status: 400,
        json: {
          error: {
            code: "INVALID_TEXT_CONFIGURATION",
            message:
              "The text contains characters the standard font cannot display. Use standard Latin characters.",
          },
        },
      });
    });

    await user.click(screen.getByRole("button", { name: /^add text$/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/cannot display/i);
    expect(screen.getByLabelText(/text to add/i)).toHaveValue("机密");
  });

  it("blocks the action when the text exceeds the budget", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    const field = screen.getByLabelText(/text to add/i);
    await user.click(field);
    await user.paste("x".repeat(501));

    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/500 characters or fewer/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^add text$/i })).toBeDisabled();
  });

  it("shows an honest indeterminate processing state and cancels via AbortController", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);
    await user.type(screen.getByLabelText(/text to add/i), "X");

    fetchMock.mockImplementation(
      (url: string, init?: RequestInit) =>
        url.includes("/api/documents/inspect")
          ? inspectResponse(4)
          : new Promise<Response>((_, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(new DOMException("aborted", "AbortError")),
              );
            }),
    );

    await user.click(screen.getByRole("button", { name: /^add text$/i }));
    expect(
      (await screen.findAllByText(/adding your text…/i)).length,
    ).toBeGreaterThanOrEqual(1);
    expect(document.querySelector("progress")).toBeNull();

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    const init = addTextCalls()[0][1] as RequestInit & { signal?: AbortSignal };
    expect(init.signal?.aborted).toBe(true);
    expect(await screen.findByRole("button", { name: /^add text$/i })).toBeEnabled();
  });

  it("reports a PDF that cannot be read instead of guessing", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) {
        return fakeResponse({
          ok: false,
          status: 422,
          json: { error: { code: "INVALID_PDF", message: "A PDF could not be opened." } },
        });
      }
      throw new Error("unexpected");
    });
    await user.upload(screen.getByLabelText(/upload a pdf/i), pdfFile("bad.pdf"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be opened/i);
    expect(screen.getByRole("button", { name: /^add text$/i })).toBeDisabled();
  });

  it("resets everything with start over", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user, "keep.pdf");
    await user.type(screen.getByLabelText(/text to add/i), "X");
    await user.click(screen.getByRole("button", { name: /^add text$/i }));
    await screen.findByRole("heading", { name: /^text added$/i });

    await user.click(screen.getByRole("button", { name: /start over/i }));
    expect(screen.getByText(/upload a pdf to get started/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/text to add/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^add text$/i })).toBeDisabled();
  });

  it("announces states politely for screen readers", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    expect(screen.getByRole("status")).toHaveTextContent(/loaded with 4 pages/i);

    await user.type(screen.getByLabelText(/text to add/i), "X");
    await user.click(screen.getByRole("button", { name: /^add text$/i }));
    await screen.findByRole("heading", { name: /^text added$/i });
    expect(screen.getByRole("status")).toHaveTextContent(/ready to download/i);
  });
});
