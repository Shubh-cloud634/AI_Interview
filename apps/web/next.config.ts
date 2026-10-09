import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@ai-interview/shared'],
  experimental: { optimizePackageImports: ['lucide-react'] },
};

export default config;
