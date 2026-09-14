import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // An unrelated package-lock.json in the user's home directory (a parent
    // of this project) otherwise makes Turbopack guess that as the
    // workspace root. Pin it explicitly instead of guessing.
    root: path.join(__dirname),
  },
};

export default nextConfig;
