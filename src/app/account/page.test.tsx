import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AccountPage from "@/app/account/page";
import * as session from "@/lib/auth/session";

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const original = await importOriginal<typeof session>();
  return {
    ...original,
    getUserIdentity: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

import { redirect } from "next/navigation";

const mockedGetIdentity = vi.mocked(session.getUserIdentity);
const mockedRedirect = vi.mocked(redirect);

describe("AccountPage", () => {
  it("redirects anonymous users to /login", async () => {
    mockedGetIdentity.mockResolvedValueOnce(session.ANONYMOUS_USER_IDENTITY);

    await AccountPage();
    expect(mockedRedirect).toHaveBeenCalledWith("/login");
  });

  it("renders profile details and usage quota for authenticated users", async () => {
    mockedGetIdentity.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "usr_test123",
      email: "bob@example.com",
      name: "Bob",
      status: "active",
      tier: "free",
    });

    const jsx = await AccountPage();
    render(jsx);

    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();
    expect(screen.getByText("usr_test123")).toBeInTheDocument();
    expect(screen.getByText("Today's Usage Quotas")).toBeInTheDocument();
    expect(screen.getByText("Jobs Processed")).toBeInTheDocument();
  });
});
