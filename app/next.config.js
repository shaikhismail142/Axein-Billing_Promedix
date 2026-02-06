/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  experimental: {
    serverComponentsExternalPackages: ['pdfkit', 'fontkit'],
  },
};

module.exports = nextConfig;
