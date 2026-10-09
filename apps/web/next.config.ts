import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@ai-interview/shared'],
  // packages/shared lives outside this app, so a build that installs only apps/web (Vercel) cannot find
  // its `zod` import. Resolve it from this app's own node_modules.
  turbopack: { resolveAlias: { zod: './node_modules/zod' } },
  experimental: { optimizePackageImports: ['lucide-react'] },
};

export default config;
