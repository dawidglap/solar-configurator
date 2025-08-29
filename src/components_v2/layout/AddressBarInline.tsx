// src/components_v2/layout/AddressBarInline.tsx
'use client';

import AddressSearchOSM from '../geocoding/AddressSearchOSM';
import { usePlannerV2Store } from '../state/plannerV2Store';
import { buildTiledSnapshot, TILE_SWISSTOPO_SAT } from '../utils/stitchTilesWMTS';
import { metersPerPixel3857, lonLatTo3857, bboxLonLatFromCenter } from '../utils/geo';
import { fetchRoofPolysForSnapshot } from '@/components_v2/services/sonnendach';
import { useState } from 'react';

const ZOOM_DEFAULT = 20;

export default function AddressBarInline() {
  const setSnapshot = usePlannerV2Store(s => s.setSnapshot);
  const setDetectedRoofs = usePlannerV2Store(s => s.setDetectedRoofs);
  const clearDetectedRoofs = usePlannerV2Store(s => s.clearDetectedRoofs);

  const [loading, setLoading] = useState(false);

  const startFromAddress = async (lat: number, lon: number) => {
    setLoading(true);
    try {
      const { dataUrl, width: w, height: h } = await buildTiledSnapshot({
        lat, lon, zoom: ZOOM_DEFAULT, width: 2800, height: 1800, scale: 1,
        tileUrl: TILE_SWISSTOPO_SAT, attribution: '© swisstopo',
      });

      const { minLon, minLat, maxLon, maxLat } = bboxLonLatFromCenter({ lon, lat }, ZOOM_DEFAULT, w, h);
      const bl = lonLatTo3857(minLon, minLat);
      const tr = lonLatTo3857(maxLon, maxLat);

      const snapObj = {
        url: dataUrl,
        width: w,
        height: h,
        mppImage: metersPerPixel3857(lat, ZOOM_DEFAULT),
        center: { lat, lon },
        zoom: ZOOM_DEFAULT,
        bbox3857: { minX: bl.x, minY: bl.y, maxX: tr.x, maxY: tr.y },
      } as const;

      setSnapshot(snapObj);

      clearDetectedRoofs();
      const raw = await fetchRoofPolysForSnapshot(snapObj, 'de');

      // ✅ Dynamic import corretto (niente .then dopo await)
      const mod = await import('../layout/RightPropertiesPanelOverlay');
      const pickFn =
        (mod as any).pickRoofsForBuilding ||
        ((arr: any) => arr);

      const building = pickFn(raw, snapObj, { expandGrowPx: 48, minAreaPx2: 700 });

      setDetectedRoofs(building.map((p: any, i: number) => ({
        id: `sd_${p.id}_${i}`,
        points: p.pointsPx,
        tiltDeg: p.tiltDeg,
        azimuthDeg: p.azimuthDeg,
        source: 'sonnendach' as const,
      })));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2 px-2 py-1">
      <div className="relative w-[340px] max-w-[64vw]">
        <AddressSearchOSM
          placeholder="Adresse eingeben…"
          onPick={(r) => startFromAddress(r.lat, r.lon)}
        />
      </div>
      {loading && <span className="text-xs text-neutral-500">Lädt…</span>}
    </div>
  );
}
