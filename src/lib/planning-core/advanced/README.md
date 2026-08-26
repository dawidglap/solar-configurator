# Advanced generic block engine

The Advanced engine is a pure TypeScript consumer of `geometry-v2`. It is not
used by the planner runtime yet, and Standard remains on `legacy-v1`.

## Physical conventions

- All geometry is metric and Cartesian inside the Planning Core.
- `planarOrientationDeg` is the geographic azimuth of the block-local `+Y`
  axis: `0° = North`, `90° = East`, `180° = South`, `270° = West`.
- Geometry-v2 Cartesian rotation is derived from that orientation. It is never
  persisted or presented as a physical azimuth.
- Module face azimuth is the normalized sum of block planar orientation and the
  slot's face offset.
- Tilt is separate from planar orientation. Rotating a block changes its
  plan-view footprint and face azimuth, but not nominal/effective tilt.

## Blocks and modules

- A block has its own collision footprint and exact grid pitch.
- A module slot has a separate projected footprint and a block-local transform.
- The generic South definition contains one slot.
- The generic East-West definition contains two slots with face offsets `0°`
  and `180°`.
- A future mounting-system adapter may provide a non-rectangular block
  footprint, any number of slots, an exact pitch, derived dimensions and
  warnings without changing geometry-v2.

This engine performs geometric preliminary planning only. It contains no
structural, ballast, wind, snow-load, rail or fastening calculations.
