import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // PDFKit and pdfjs-dist resolve fonts/workers relative to the installed
  // package; must not be bundled by webpack (bundling pdfjs-dist crashes
  // with "Object.defineProperty called on non-object" at import time).
  serverExternalPackages: ["pdfkit", "pdfjs-dist"],
};

export default nextConfig;
