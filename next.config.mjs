/** @type {import('next').NextConfig} */
const nextConfig = {
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
