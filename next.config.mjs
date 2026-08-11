/** @type {import('next').NextConfig} */
const nextConfig = {
  // The zones pages lived at /geofences until Aug 6 2026 — keep old links,
  // bookmarks, and AI deep links working forever.
  async redirects() {
    return [
      { source: '/geofences', destination: '/zones', permanent: true },
      { source: '/geofences/:path*', destination: '/zones/:path*', permanent: true },
    ]
  },
  experimental: {
    // h5wasm loads its .wasm from disk at runtime — bundling it breaks the
    // path, so it stays external (used by /api/lightning-strikes for GLM).
    serverComponentsExternalPackages: ['h5wasm'],
    serverActions: {
      // Asset photos are resized client-side (~200-500 KB) before riding a
      // server action; anything big (zone site imagery, up to 50 MB) goes
      // direct to Supabase Storage via signed URL instead — Vercel hard-caps
      // serverless request bodies at ~4.5 MB, so raising this can't help.
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
