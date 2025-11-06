import path from "path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { appDir: true },
  webpack: (config) => {
    // Make '@' point to the project root so '@/components/...' works in Webpack too
    config.resolve.alias["@"] = path.resolve(__dirname, ".");
    return config;
  },
};

export default nextConfig;
