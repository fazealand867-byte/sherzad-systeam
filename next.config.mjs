/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  distDir: 'hostinger_public_html',
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
