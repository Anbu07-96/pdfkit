import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Sandboxed/proxied preview hosts used during development.
  allowedDevOrigins: ["*.e2b.app", "*.app.github.dev", "*.gitpod.io"],
  poweredByHeader: false,
  // The pdfium rasterizer ships as WebAssembly; leave it to Node's resolver
  // instead of bundling it into the server output.
  serverExternalPackages: ["@hyzyla/pdfium"],
  // The two page tools were renamed when they shipped (Phase 4); keep the old
  // catalog URLs working.
  async redirects() {
    return [
      {
        source: "/tools/extract-pages",
        destination: "/tools/extract-pdf-pages",
        permanent: true,
      },
      {
        source: "/tools/delete-pages",
        destination: "/tools/delete-pdf-pages",
        permanent: true,
      },
      {
        source: "/tools/reorder-pages",
        destination: "/tools/reorder-pdf-pages",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
