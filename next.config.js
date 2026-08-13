/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // pdf-parse must stay external: bundling it strips pdf.worker.mjs, which
    // breaks /api/syllabus/extract at runtime (build still passes).
    serverComponentsExternalPackages: ['pdf-parse'],
  },
}

module.exports = nextConfig
