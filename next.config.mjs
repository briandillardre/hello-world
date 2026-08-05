/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      // Asset photos are resized client-side (~200-500 KB), but zone site
      // imagery uploads drone JPEGs as-is for evidence quality — Mavic shots
      // run 5-9 MB and the imagery action caps at 12 MB, so allow headroom.
      bodySizeLimit: '15mb',
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
