'use client';

import TopToolbar from './TopToolbar';

export default function OverlayTopToolbar() {
  return (
    <div
      className="pointer-events-none absolute left-0 right-0 z-[200] w-full px-0"
      style={{ top: 'var(--tb, 48px)' }} // fallback 56px, così resta sotto la topbar
    >
      <div className="pointer-events-auto relative mx-auto max-w-[1600px]  border border-neutral-200 bg-neutral-100 backdrop-blur shadow-sm">
        {/* gradient fade ai bordi quando c'è overflow */}
       
        
        <TopToolbar />
      </div>
    </div>
  );
}
