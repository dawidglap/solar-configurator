'use client';

import TopToolbar from './TopToolbar';

export default function OverlayTopToolbar() {
  return (
   <div className="pointer-events-none absolute top-[64px] left-1/2 -translate-x-1/2 z-[200] w-[calc(100%-16px)] max-w-[1100px] px-2">
  <div className="pointer-events-auto relative rounded-full border bg-white/85 backdrop-blur shadow-sm">
    <TopToolbar/>
  </div>
</div>

  );
}
