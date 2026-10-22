import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // allows running several local dev servers side by side (QA); defaults to .next
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
