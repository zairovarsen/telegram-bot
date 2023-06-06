const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (
    config,
    { buildId, dev, isServer, defaultLoaders, webpack, nextRuntime },
  ) => {
    config.resolve.alias['fluent-ffmpeg'] = path.join(
      __dirname,
      'node_modules',
      'fluent-ffmpeg',
      'lib',
      'fluent-ffmpeg.js',
    )

    config.plugins.push(
      new webpack.IgnorePlugin({
        checkResource(resource) {
          const lazyImports = [
            '@ffmpeg-installer/ffmpeg/index.js',
            'fluent-ffmpeg/lib/options/misc.js',
          ]
          return lazyImports.some(lazyImport => resource.endsWith(lazyImport))
        },
      }),
    )

    config.experiments = { asyncWebAssembly: true, layers: true }

    // Important: return the modified config
    return config
  },
}

module.exports = nextConfig
