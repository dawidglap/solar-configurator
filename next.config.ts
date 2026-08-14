// next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit", "dejavu-fonts-ttf"],
  outputFileTracingIncludes: {
    "/api/invoices/*/pdf": ["./node_modules/pdfkit/js/data/*.afm"],
    "/api/public/offer-signature/*/vollmacht": ["./node_modules/dejavu-fonts-ttf/ttf/*.ttf"],
  },
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
