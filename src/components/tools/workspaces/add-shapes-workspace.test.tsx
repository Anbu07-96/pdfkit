import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddShapesWorkspace } from "@/components/tools/workspaces/add-shapes-workspace";
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
      <AddShapesWorkspace limits={LIMITS} />
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

function shapesAddedResponse(stamped: number, pages: number) {
  return fakeResponse({
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="document-shapes-added.pdf"',
      "x-pdfkit-pages": String(pages),
      "x-pdfkit-output-pages": String(pages),
      "x-pdfkit-shape-pages": String(stamped),
      "x-pdfkit-artifacts": "1",
    },
    blob: new Blob(["%PDF-"], { type: "application/pdf" }),
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

function addShapesCalls() {
  return fetchMock.mock.calls.filter((call) => call[0] === "/api/tools/add-shapes");
}

async function upload(
  user: ReturnType<typeof userEvent.setup>,
  name = "document.pdf",
) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/api/documents/inspect")) return inspectResponse(3);
    return shapesAddedResponse(3, 3);
  });
  await user.upload(screen.getByLabelText(/upload a pdf/i), pdfFile(name));
  await screen.findByText(/shape type/i);
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AddShapesWorkspace", () => {
  it("starts with upload zone and disabled action", () => {
    renderWorkspace();
    expect(screen.getByLabelText(/upload a pdf/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^add shape$/i })).toBeDisabled();
  });

  it("shows options upon upload", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user, "test.pdf");

    expect(screen.getByText("test.pdf", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^add shape$/i })).toBeEnabled();
  });

  it("sends request options to server when button clicked", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    await user.click(screen.getByRole("button", { name: /^add shape$/i }));

    await waitFor(() => expect(addShapesCalls()).toHaveLength(1));
    const form = addShapesCalls()[0][1].body as FormData;
    expect(form.get("shape")).toBe("rectangle");
    expect(form.get("placement")).toBe("center");
  });
});
