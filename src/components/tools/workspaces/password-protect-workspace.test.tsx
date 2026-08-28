import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PasswordProtectWorkspace } from "@/components/tools/workspaces/password-protect-workspace";
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
      <PasswordProtectWorkspace limits={LIMITS} />
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

function protectedResponse(pages: number) {
  return fakeResponse({
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="document-protected.pdf"',
      "x-pdfkit-pages": String(pages),
      "x-pdfkit-output-pages": String(pages),
      "x-pdfkit-artifacts": "1",
    },
    blob: new Blob(["%PDF-"], { type: "application/pdf" }),
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

function protectCalls() {
  return fetchMock.mock.calls.filter(
    (call) => call[0] === "/api/tools/password-protect",
  );
}

async function upload(
  user: ReturnType<typeof userEvent.setup>,
  name = "document.pdf",
) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/api/documents/inspect")) return inspectResponse(3);
    return protectedResponse(3);
  });
  await user.upload(screen.getByLabelText(/upload a pdf/i), pdfFile(name));
  await screen.findByLabelText(/^password$/i);
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PasswordProtectWorkspace", () => {
  it("starts with an upload prompt, a disabled action and no password fields", () => {
    renderWorkspace();
    expect(screen.getByLabelText(/upload a pdf/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^protect pdf$/i }),
    ).toBeDisabled();
    expect(screen.queryByLabelText(/^password$/i)).not.toBeInTheDocument();
  });

  it("shows the page count, password fields and the honest encryption note", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user, "report.pdf");

    expect(screen.getByText("report.pdf", { selector: "span" })).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === "3 pages"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();

    // Honesty up front: RC4 named, AES-256 explicitly not claimed.
    expect(
      screen.getByRole("heading", { name: /real protection, honestly described/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/not AES-256/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/RC4 128-bit/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/military-grade/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/zero-knowledge/i)).not.toBeInTheDocument();
  });

  it("keeps the action disabled until both password entries match", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    const button = screen.getByRole("button", { name: /^protect pdf$/i });
    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText(/^password$/i), "open-sesame");
    expect(button).toBeDisabled(); // confirmation still missing

    await user.type(screen.getByLabelText(/confirm password/i), "open-sesam");
    expect(button).toBeDisabled();
    expect(screen.getByText(/do not match/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/confirm password/i), "e");
    expect(button).toBeEnabled();
  });

  it("sends only the password — never the confirmation", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    await user.type(screen.getByLabelText(/^password$/i), "s3cret pass");
    await user.type(screen.getByLabelText(/confirm password/i), "s3cret pass");
    await user.click(screen.getByRole("button", { name: /^protect pdf$/i }));

    await waitFor(() => expect(protectCalls()).toHaveLength(1));
    const form = protectCalls()[0][1].body as FormData;
    expect(form.get("password")).toBe("s3cret pass");
    expect(form.get("confirm")).toBeNull();
    expect(form.getAll("files")).toHaveLength(1);
  });

  it("reveals and hides the password on demand", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    const field = screen.getByLabelText(/^password$/i);
    expect(field).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: /show the password/i }));
    expect(field).toHaveAttribute("type", "text");

    await user.click(screen.getByRole("button", { name: /hide the password/i }));
    expect(field).toHaveAttribute("type", "password");
  });

  it("renders the server-confirmed success state and clears the password fields", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    await user.type(screen.getByLabelText(/^password$/i), "pw");
    await user.type(screen.getByLabelText(/confirm password/i), "pw");
    await user.click(screen.getByRole("button", { name: /^protect pdf$/i }));

    expect(
      await screen.findByRole("heading", { name: /^pdf protected$/i }),
    ).toBeInTheDocument();
    // Server-confirmed facts, plus the honest encryption note.
    expect(screen.getByText(/3 pages, content unchanged/i)).toBeInTheDocument();
    expect(screen.getByText(/verified/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /download protected pdf/i }),
    ).toHaveAttribute("href");
    // The password fields are cleared once the job succeeded.
    expect(screen.getByLabelText(/^password$/i)).toHaveValue("");
    expect(screen.getByLabelText(/confirm password/i)).toHaveValue("");
  });

  it("surfaces a server error as an alert", async () => {
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
            code: "ENCRYPTED_PDF",
            message:
              "This PDF already has a password. Unlock it first if you want to protect it with a new one.",
          },
        },
      });
    });

    await user.type(screen.getByLabelText(/^password$/i), "pw");
    await user.type(screen.getByLabelText(/confirm password/i), "pw");
    await user.click(screen.getByRole("button", { name: /^protect pdf$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/already has a password/i);
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
    expect(
      screen.getByRole("button", { name: /^protect pdf$/i }),
    ).toBeDisabled();
  });

  it("resets everything with start over", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user, "keep.pdf");
    await user.type(screen.getByLabelText(/^password$/i), "pw");

    await user.click(screen.getByRole("button", { name: /start over/i }));
    expect(screen.getByText(/upload a pdf to get started/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^password$/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^protect pdf$/i }),
    ).toBeDisabled();
  });

  it("announces states politely for screen readers", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    expect(screen.getByRole("status")).toHaveTextContent(/loaded with 3 pages/i);

    await user.type(screen.getByLabelText(/^password$/i), "pw");
    await user.type(screen.getByLabelText(/confirm password/i), "pw");
    await user.click(screen.getByRole("button", { name: /^protect pdf$/i }));
    await screen.findByRole("heading", { name: /^pdf protected$/i });
    expect(screen.getByRole("status")).toHaveTextContent(/ready to download/i);
  });
});
