import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sites does not expose a Cloudflare Images binding for this project.
  // Keep all app assets direct; receipt images are normalized by our own pipeline.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
