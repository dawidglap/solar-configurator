'use client';

import TopToolbar from './TopToolbar';

export default function OverlayTopToolbar() {
  return (
    <div className="pointer-events-none absolute top-[56px] z-[200] w-full  px-2">
      <div className="pointer-events-auto relative rounded-full border bg-white/85 backdrop-blur shadow-sm">
        <TopToolbar/>
      </div>
    </div>
  );
}

