/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        // Embed routes must be iframe-able from anywhere.
        source: '/embed/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: 'frame-ancestors *' },
        ],
      },
    ]
  },
}

export default nextConfig
