import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  async redirects() {
    return [
      {
        source: "/embed/:path*",
        has: [
          {
            type: "host",
            value: "127.0.0.1",
          },
        ],
        destination: "http://localhost:3020/embed/:path*",
        permanent: false,
      },
      {
        source: "/persistent-report",
        has: [
          {
            type: "host",
            value: "127.0.0.1",
          },
        ],
        destination: "http://localhost:3020/persistent-report",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/api/report/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" },
        ],
      },
      {
        source: "/embed/:path*",
        headers: [
          { key: "X-Frame-Options", value: "ALLOWALL" },
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
        ],
      },
      {
        source: "/persistent-report",
        headers: [
          { key: "X-Frame-Options", value: "ALLOWALL" },
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
        ],
      },
    ];
  },
};

export default nextConfig;
