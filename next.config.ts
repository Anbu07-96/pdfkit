import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com; frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com; connect-src 'self' https://lumberjack.razorpay.com https://api.razorpay.com; img-src 'self' data: blob: https://cdn.razorpay.com; style-src 'self' 'unsafe-inline'; font-src 'self' data:;",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Sandboxed/proxied preview hosts used during development.
  allowedDevOrigins: ["*.e2b.app", "*.app.github.dev", "*.gitpod.io"],
  poweredByHeader: false,
  // The pdfium rasterizer ships as WebAssembly; leave it to Node's resolver
  // instead of bundling it into the server output.
  serverExternalPackages: ["@hyzyla/pdfium"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
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
      {
        source: "/tools/jpg-to-pdf",
        destination: "/tools/images-to-pdf",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
