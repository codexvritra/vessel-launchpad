import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Silence workspace-root inference warnings in this monorepo.
  outputFileTracingRoot: process.cwd(),
  images: {
    // Art can come from arbitrary IPFS/HTTP gateways; keep unoptimized so
    // the build never tries to reach out to a loader at compile time.
    unoptimized: true,
  },
  webpack: (config, { webpack }) => {
    // The Coinbase Base Account connector (pulled in transitively by
    // wagmi/RainbowKit) references optional `@x402/*` payment modules and a
    // few Node-only logger packages that are not installed. We never invoke
    // those code paths, so ignore them rather than fail the build.
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp: /^@x402\//,
      }),
    );
    config.externals = config.externals || [];
    if (Array.isArray(config.externals)) {
      config.externals.push("pino-pretty", "lokijs", "encoding");
    }
    // MetaMask SDK optionally imports React Native async storage; not used on web.
    config.resolve = config.resolve || {};
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },
};

export default nextConfig;
