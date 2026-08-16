import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  turbopack: {
    root: __dirname,
  },

  // Optional, but helps avoid surprises with static export.
  images: { unoptimized: true },
};

export default nextConfig;
