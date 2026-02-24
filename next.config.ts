import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,

  // Optional, but helps avoid surprises with static export.
  images: { unoptimized: true },
};

export default nextConfig;