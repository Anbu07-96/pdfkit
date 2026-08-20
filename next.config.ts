import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Sandboxed/proxied preview hosts used during development.
  allowedDevOrigins: ["*.e2b.app", "*.app.github.dev", "*.gitpod.io"],
  poweredByHeader: false,
};

export default nextConfig;
