import type { NextConfig } from "next";
import { normalizeBasePath } from "./src/lib/base-path";

const basePath = normalizeBasePath(process.env.BASE_PATH ?? "");

const nextConfig: NextConfig = {
  devIndicators: false,
  output: "standalone",
  ...(basePath ? { basePath } : {}),
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
