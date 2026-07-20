import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // The /_next/image optimizer returns broken images for the remote avatar/
    // flag hosts in this deployment, so serve every next/image directly as a
    // plain <img> (no optimizer). remotePatterns are kept for the day the
    // optimizer is re-enabled, though they're ignored while unoptimized.
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "*.googleusercontent.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "flagcdn.com" },
    ],
  },
  serverExternalPackages: ["better-sqlite3", "@prisma/adapter-better-sqlite3"],
  turbopack: {},
  async headers() {
    return [
      {
        // HTML pages only — excludes hashed static assets which are immutable
        source: "/((?!_next/static|_next/image|favicon|icons).*)",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
