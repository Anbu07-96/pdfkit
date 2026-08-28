import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnlockPdfWorkspace } from "@/components/tools/workspaces/unlock-pdf-workspace";
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
      <UnlockPdfWorkspace limits={LIMITS} />
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

function inspectEncryptedResponse() {
  return fakeResponse({
    ok: false,
    status: 422,
    json: {
      error: {
        code: "ENCRYPTED_PDF",
        message: "Password-protected PDFs cannot be processed yet.",
      },
    },
  });
}

function inspectPlainResponse(pageCount = 5) {
  return fakeResponse({
    headers: { "content-type": "application/json" },
    json: { fileName: "document.pdf", size: 4096, pageCount },
  });
}

function unlockedResponse(pages: number) {
  return fakeResponse({
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="document-unlocked.pdf"',
      "x-pdfkit-pages": String(pages),
      "x-pdfkit-output-pages": String(pages),
      "x-pdfkit-artifacts": "1",
    },
    blob: new Blob(["%PDF-"], { type: "application/pdf" }),
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

function unlockCalls() {
  return fetchMock.mock.calls.filter((call) => call[0] === "/api/tools/unlock-pdf");
}

/** Upload a file the server inspects as protected. */
async function uploadProtected(
  user: ReturnType<typeof userEvent.setup>,
  name = "protected.pdf",
) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/api/documents/inspect")) return inspectEncryptedResponse();
    return unlockedResponse(3);
  });
  await user.upload(screen.getByLabelText(/upload a protected pdf/i), pdfFile(name));
  await screen.findByLabelText(/^password$/i);
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UnlockPdfWorkspace", () => {
  it("starts with an upload prompt, a disabled action and no password field", () => {
    renderWorkspace();
    expect(screen.getByLabelText(/upload a protected pdf/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^unlock pdf$/i }),
    ).toBeDisabled();
    expect(screen.queryByLabelText(/^password$/i)).not.toBeInTheDocument();
  });

  it("asks for the password once the server confirms the file is protected", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadProtected(user, "contract.pdf");

    expect(screen.getByText("contract.pdf", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute("type", "password");
    expect(
      screen.getByRole("heading", { name: /for files you own/i }),
    ).toBeInTheDocument();
    // The action is available even before typing: empty user passwords exist.
    expect(screen.getByRole("button", { name: /^unlock pdf$/i })).toBeEnabled();
  });

  it("tells the user when the PDF has no protection to remove", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectPlainResponse(5);
      throw new Error("unexpected");
    });
    await user.upload(screen.getByLabelText(/upload a protected pdf/i), pdfFile());

    expect(
      await screen.findByRole("heading", { name: /this pdf is not protected/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^password$/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^unlock pdf$/i }),
    ).toBeDisabled();
  });

  it("sends the password exactly as typed", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadProtected(user);

    await user.type(screen.getByLabelText(/^password$/i), "  Exact Entry 1 ");
    await user.click(screen.getByRole("button", { name: /^unlock pdf$/i }));

    await waitFor(() => expect(unlockCalls()).toHaveLength(1));
    const form = unlockCalls()[0][1].body as FormData;
    expect(form.get("password")).toBe("  Exact Entry 1 ");
    expect(form.getAll("files")).toHaveLength(1);
  });

  it("renders the server-confirmed success state and clears the password", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadProtected(user);

    await user.type(screen.getByLabelText(/^password$/i), "pw");
    await user.click(screen.getByRole("button", { name: /^unlock pdf$/i }));

    expect(
      await screen.findByRole("heading", { name: /^pdf unlocked$/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/3 pages, content unchanged/i)).toBeInTheDocument();
    expect(screen.getByText(/verified/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /download unlocked pdf/i }),
    ).toHaveAttribute("href");
    expect(screen.getByLabelText(/^password$/i)).toHaveValue("");
  });

  it("surfaces WRONG_PASSWORD from the server", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadProtected(user);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectEncryptedResponse();
      return fakeResponse({
        ok: false,
        status: 422,
        json: {
          error: {
            code: "WRONG_PASSWORD",
            message: "That password does not unlock this PDF. Check the password and try again.",
          },
        },
      });
    });

    await user.type(screen.getByLabelText(/^password$/i), "nope");
    await user.click(screen.getByRole("button", { name: /^unlock pdf$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/does not unlock/i);
  });

  it("surfaces UNSUPPORTED_ENCRYPTION for AES files", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadProtected(user);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectEncryptedResponse();
      return fakeResponse({
        ok: false,
        status: 422,
        json: {
          error: {
            code: "UNSUPPORTED_ENCRYPTION",
            message:
              "This PDF uses AES-class encryption (V4/R4), which Unlock PDF does not support. Only RC4-protected files (40-bit and 128-bit) can be unlocked here.",
          },
        },
      });
    });

    await user.click(screen.getByRole("button", { name: /^unlock pdf$/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/AES-class/i);
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
    await user.upload(screen.getByLabelText(/upload a protected pdf/i), pdfFile("bad.pdf"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be opened/i);
    expect(
      screen.getByRole("button", { name: /^unlock pdf$/i }),
    ).toBeDisabled();
  });

  it("resets everything with start over", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadProtected(user, "keep.pdf");

    await user.click(screen.getByRole("button", { name: /start over/i }));
    expect(
      screen.getByText(/upload a protected pdf to get started/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^password$/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^unlock pdf$/i }),
    ).toBeDisabled();
  });

  it("announces states politely for screen readers", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadProtected(user);

    expect(screen.getByRole("status")).toHaveTextContent(/pdf is protected/i);

    await user.type(screen.getByLabelText(/^password$/i), "pw");
    await user.click(screen.getByRole("button", { name: /^unlock pdf$/i }));
    await screen.findByRole("heading", { name: /^pdf unlocked$/i });
    expect(screen.getByRole("status")).toHaveTextContent(/ready to download/i);
  });
});
