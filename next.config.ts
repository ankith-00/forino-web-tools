import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["nimble-fleshed-caring.ngrok-free.dev"],
  // Tool routes moved under /tools and were renamed to match their dashboard
  // titles. These are the pre-rename production URLs, each pointing straight at
  // its final destination so old bookmarks resolve in a single hop.
  async redirects() {
    return [
      { source: "/scanner", destination: "/tools/invigilation-module", permanent: true },
      { source: "/webcam-scanner", destination: "/tools/booklet-scanner", permanent: true },
      { source: "/barcode", destination: "/tools/barcode-marker", permanent: true },
      { source: "/id-card", destination: "/tools/id-card-maker", permanent: true },
      { source: "/attendance-records", destination: "/tools/attendance-records", permanent: true },
    ];
  },
};

export default nextConfig;