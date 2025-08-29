// next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  eslint: {
    // ✅ Disabilita i controlli ESLint durante il build (anche su Vercel)
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    // Evita che Webpack provi a risolvere il pacchetto nativo "canvas"
    // quando attraversa la build server-side di konva/react-konva.
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      canvas: false,
    };
    return config;
  },
};

export default nextConfig;
