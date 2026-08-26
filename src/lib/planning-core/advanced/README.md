# Advanced generic block engine

The Advanced engine is a pure TypeScript consumer of `geometry-v2`. Advanced
per-roof drafts and applied layouts use it in the planner runtime, while
Standard remains on `legacy-v1`.

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

## Applied per-roof persistence

`surfacePlanning` is an optional field on a roof. Its absence remains the
legacy Standard contract and is never materialized merely by loading a
planning. Schema version 1 stores physical surface properties separately from
Advanced PV inputs, including a geometric module snapshot and exact engine and
adapter identities. Derived K2 values and generated counts are deliberately not
authoritative persisted inputs.

Consumers must resolve persisted data through `resolveSurfacePlanning` before
using it. Unknown future systems or versions remain raw and are reported as
unsupported Advanced data; they are never downgraded to Standard. Hydration
does not call a mounting adapter or regenerate materialized panels.

## Green-roof V1 scope

Green roofs use only the versioned generic South and East-West definitions.
`undersideClearanceM` is persisted with the Advanced mounting inputs because
Höhe UK describes the underside of the mounting construction, not the physical
roof surface. It is vertical metadata and does not modify the 2D footprint.

The K2 Product Brochure describes GreenRoof Vento capabilities including
portrait/landscape modules, 10°/15° variants, S/A/V arrangements and variable
row spacing. It is not a dimensional system-data sheet. Exact footprints,
component dimensions, permitted UK-height ranges and row formulas are therefore
not verified and no `k2-greenroof-vento` adapter exists. Green-roof V1 is
explicitly a free geometric preliminary layout.
