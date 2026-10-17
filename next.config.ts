import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A separate dist dir lets a verification build run beside the user's dev server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  // Uploaded sketches are sent to the local vision route as data URLs.
  experimental: { serverActions: { bodySizeLimit: "8mb" } },
};

export default nextConfig;
