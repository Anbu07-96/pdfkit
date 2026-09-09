import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PricingPage from "@/app/pricing/page";
import { PLANS, formatInr } from "@/lib/billing/plans";
import { TOOLS } from "@/lib/tools/catalog";

/**
 * Phase 66 — pricing page renders from the plan catalog (single source of
 * truth) with truthful feature claims only.
 */
describe("PricingPage", () => {
  it("renders all three plans with catalog prices", () => {
    render(<PricingPage />);

    for (const plan of PLANS) {
      expect(screen.getByText(`${plan.name} Plan`)).toBeInTheDocument();
    }
    expect(screen.getByText(formatInr(0))).toBeInTheDocument(); // Free
    expect(screen.getByText(formatInr(49900))).toBeInTheDocument(); // Pro
    expect(screen.getByText(formatInr(249900))).toBeInTheDocument(); // Business
  });

  it("lists only implemented features per plan", () => {
    render(<PricingPage />);
    const text = document.body.textContent ?? "";
    for (const plan of PLANS) {
      for (const feature of plan.features) {
        // Shared labels (e.g. bulk allowances) can appear for two plans.
        expect(text).toContain(feature.label);
      }
    }
  });

  it("advertises the real available-tool count from the catalog", () => {
    render(<PricingPage />);
    const available = TOOLS.filter((t) => t.status === "AVAILABLE").length;
    expect(screen.getByText(new RegExp(`All ${available} available tools`))).toBeInTheDocument();
  });

  it("does not claim priority processing or dedicated support", () => {
    const { container } = render(<PricingPage />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/priority processing/i);
    expect(text).not.toMatch(/dedicated support/i);
  });

  it("points Business inquiries at /contact and Free at /register", () => {
    render(<PricingPage />);
    const contactLinks = screen.getAllByRole("link", { name: "Contact Sales" });
    expect(contactLinks.length).toBeGreaterThan(0);
    expect(contactLinks[0].getAttribute("href")).toBe("/contact");
    expect(screen.getByRole("link", { name: "Get Started Free" }).getAttribute("href")).toBe("/register");
  });
});
