import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Remove turbopack config entirely - don't set it to null
  // This tells Next.js to use the default bundler (webpack)
  
  // If you need webpack customizations, they go here
  webpack: (config, { isServer }) => {
    return config;
  },
};

export default nextConfig;