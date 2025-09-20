// components_v2/layout/PageContainer.tsx
'use client';

export default function PageContainer({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{ paddingLeft: 'var(--sb, 64px)' }}
      className="min-h-dvh"
    >
      {children}
    </div>
  );
}
