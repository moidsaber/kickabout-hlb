import type { NextConfig } from "next";

// Note: cacheComponents is deliberately OFF. With it on, `next build` tries to
// prerender GET route handlers and opens database connections during the build,
// which can leave the build process hanging. Every page here loads live data anyway.
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
