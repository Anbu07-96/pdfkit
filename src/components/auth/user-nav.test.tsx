import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UserNav } from "@/components/auth/user-nav";

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

import { useSession, signIn } from "next-auth/react";

const mockedUseSession = vi.mocked(useSession);
const mockedSignIn = vi.mocked(signIn);

describe("UserNav", () => {
  it("renders Sign in button when unauthenticated", async () => {
    const user = userEvent.setup();
    mockedUseSession.mockReturnValue({
      data: null,
      status: "unauthenticated",
      update: vi.fn(),
    });

    render(<UserNav />);
    const signInBtn = screen.getByRole("button", { name: /sign in/i });
    expect(signInBtn).toBeInTheDocument();

    await user.click(signInBtn);
    expect(mockedSignIn).toHaveBeenCalledTimes(1);
  });

  it("renders account link and Sign out button when authenticated", () => {
    mockedUseSession.mockReturnValue({
      data: {
        user: { name: "Alice", email: "alice@example.com" },
        expires: "2099-01-01",
      },
      status: "authenticated",
      update: vi.fn(),
    });

    render(<UserNav />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });
});
