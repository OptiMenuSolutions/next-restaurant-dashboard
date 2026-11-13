/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['geo-tz'],
  outputFileTracingIncludes: {
    '/api/account/save-shipping-address': [
      './node_modules/geo-tz/data/timezones-1970.geojson.*',
    ],
  },
}

module.exports = nextConfig