import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/admin/rebuild-database": [
      "./supabase/migrations/20260629020000_create_initial_schema.sql",
    ],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "placehold.co",
      },
      {
        protocol: "https",
        hostname: "thumbnail.image.rakuten.co.jp",
      },
      {
        protocol: "https",
        hostname: "books.r10s.jp",
      },
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
    ],
  },
};

export default nextConfig;
