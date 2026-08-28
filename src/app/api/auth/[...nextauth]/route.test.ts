// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/auth/[...nextauth]/route";

describe("/api/auth/[...nextauth]", () => {
  it("exports GET and POST handlers", () => {
    expect(typeof GET).toBe("function");
    expect(typeof POST).toBe("function");
  });
});
