import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MergePdfWorkspace } from "@/components/tools/workspaces/merge-pdf-workspace";
import { ToastProvider } from "@/components/ui/toast";

const LIMITS = {
  minFiles: 2,
  maxFiles: 20,
  maxFileSize: 25 * 1024 * 1024,
  maxTotalSize: 100 * 1024 * 1024,
};

function pdfFile(name: string, size = 2048) {
  const file = new File(["%PDF-1.7"], name, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function renderWorkspace() {
  return render(
    <ToastProvider>
      <MergePdfWorkspace limits={LIMITS} />
    </ToastProvider>,
  );
}

/**
 * Minimal stand-in for a `fetch` response. jsdom's Blob cannot be used to build
 * a real undici `Response`, and the client only needs these members.
 */
function fakeResponse({
  ok,
  status,
  headers,
  blob,
  json,
}: {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
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

function mergedPdfResponse() {
  return fakeResponse({
    ok: true,
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="merged.pdf"',
      "x-pdfkit-pages": "3",
    },
    blob: new Blob(["%PDF-1.7 merged"], { type: "application/pdf" }),
  });
}

function jsonErrorResponse(
  status: number,
  code: string,
  message: string,
  details?: string[],
) {
  return fakeResponse({
    ok: false,
    status,
    headers: { "content-type": "application/json" },
    json: { error: { code, message, details } },
  });
}

async function addFiles(user: ReturnType<typeof userEvent.setup>, names: string[]) {
  const input = screen.getByLabelText(/upload your pdf files/i);
  for (const name of names) {
    await user.upload(input, pdfFile(name));
  }
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MergePdfWorkspace", () => {
  it("asks for at least two files before merging", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    expect(screen.getByRole("button", { name: /merge pdfs/i })).toBeDisabled();
    expect(screen.getByText(/add at least 2 pdf files/i)).toBeInTheDocument();

    await addFiles(user, ["a.pdf"]);
    expect(screen.getByRole("button", { name: /merge pdfs/i })).toBeDisabled();

    await addFiles(user, ["b.pdf"]);
    expect(screen.getByRole("button", { name: /merge pdfs/i })).toBeEnabled();
  });

  it("shows the selected files in order with reorder controls", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await addFiles(user, ["a.pdf", "b.pdf", "c.pdf"]);

    const list = within(screen.getByRole("region", { name: /selected files/i }));
    expect(list.getByText("a.pdf")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /move b\.pdf up/i }),
    ).toBeInTheDocument();
    // The first file cannot move up and the last cannot move down.
    expect(screen.getByRole("button", { name: /move a\.pdf up/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /move c\.pdf down/i })).toBeDisabled();
  });

  it("sends the files in the order the user arranged them", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(mergedPdfResponse());
    renderWorkspace();

    await addFiles(user, ["a.pdf", "b.pdf"]);
    await user.click(screen.getByRole("button", { name: /move b\.pdf up/i }));
    await user.click(screen.getByRole("button", { name: /merge pdfs/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/tools/merge-pdf");
    expect(init.method).toBe("POST");

    const sent = (init.body as FormData).getAll("files") as File[];
    expect(sent.map((file) => file.name)).toEqual(["b.pdf", "a.pdf"]);
  });

  it("offers a real download when the merge succeeds", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(mergedPdfResponse());
    renderWorkspace();

    await addFiles(user, ["a.pdf", "b.pdf"]);
    await user.click(screen.getByRole("button", { name: /merge pdfs/i }));

    const link = await screen.findByRole("link", { name: /download merged pdf/i });
    expect(link).toHaveAttribute("download", "merged.pdf");
    expect(link.getAttribute("href")).toMatch(/^blob:/);
    expect(screen.getByText(/your merged pdf is ready/i)).toBeInTheDocument();
    expect(screen.getByText(/3 pages/i)).toBeInTheDocument();
  });

  it("removes a file from the selection", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await addFiles(user, ["a.pdf", "b.pdf"]);
    await user.click(screen.getByRole("button", { name: /remove a\.pdf/i }));

    expect(screen.queryByText("a.pdf")).not.toBeInTheDocument();
    expect(screen.getByText("1 file selected")).toBeInTheDocument();
  });

  it("shows the server error message when processing fails", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonErrorResponse(422, "INVALID_PDF", "Some files are not valid PDF documents.", [
        "broken.pdf does not contain a PDF file signature.",
      ]),
    );
    renderWorkspace();

    await addFiles(user, ["a.pdf", "broken.pdf"]);
    await user.click(screen.getByRole("button", { name: /merge pdfs/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/some files are not valid pdf documents/i);
    expect(alert).toHaveTextContent(/broken\.pdf does not contain a pdf file signature/i);
    expect(screen.queryByRole("link", { name: /download/i })).not.toBeInTheDocument();
  });

  it("reports a network failure without pretending to succeed", async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    renderWorkspace();

    await addFiles(user, ["a.pdf", "b.pdf"]);
    await user.click(screen.getByRole("button", { name: /merge pdfs/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not be sent|something went wrong/i,
    );
  });

  it("clears everything when starting over", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(mergedPdfResponse());
    renderWorkspace();

    await addFiles(user, ["a.pdf", "b.pdf"]);
    await user.click(screen.getByRole("button", { name: /merge pdfs/i }));
    await screen.findByRole("link", { name: /download merged pdf/i });

    await user.click(screen.getByRole("button", { name: /merge different files/i }));

    expect(screen.queryByRole("link", { name: /download merged pdf/i })).not.toBeInTheDocument();
    expect(screen.queryByText("a.pdf")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /merge pdfs/i })).toBeDisabled();
  });
});
