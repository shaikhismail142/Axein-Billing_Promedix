/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  output: process.env.AXEIN_DESKTOP === '1' ? 'standalone' : undefined,
  experimental: {
    serverComponentsExternalPackages: ['pdfkit', 'fontkit'],
  },
};

module.exports = nextConfig;
