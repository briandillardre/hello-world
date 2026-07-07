/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      // Asset photos travel through a server action as FormData. They're
      // resized client-side to ≤1600px JPEG (~200-500 KB), so 4 MB is
      // generous headroom without inviting abuse.
      bodySizeLimit: '4mb',
    },
  },
  webpack: (config) => {
    // maplibre-gl uses some Node.js APIs that need to be stubbed in browser
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      os: false,
    }
    return config
  },
  // Allow CARTO tile images
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.basemaps.cartocdn.com' },
      { protocol: 'https', hostname: 'api.maptiler.com' },
    ],
  },
}

export default nextConfig
