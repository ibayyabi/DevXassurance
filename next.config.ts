import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // PDFKit reads standard font metrics relative to its installed package.
  serverExternalPackages: ["pdfkit"],
};

export default nextConfig;
