# Geometry v2 foundation

`geometry-v2` is a pure TypeScript geometry kernel. It is not used by the
planner runtime yet; `legacy-v1` remains the active Standard engine.

## Coordinates and angles

- Core geometry uses meters and Cartesian axes (`x` right, `y` up).
- Image coordinates (`y` down) are converted only by the coordinate adapter.
- `rotationCartesianDeg`, `canvasAngleDeg`, and geographic azimuth are separate
  concepts with explicitly named conversion helpers.

## Grid semantics

- A placement unit has a polygon footprint and an independent `pitchM`.
- `phaseX` and `phaseY` are normalized fractions in `[0, 1)` of the respective
  pitch.
- `start` anchors the first origin to the minimum feasible origin plus phase.
- `end` anchors the last origin to the maximum feasible origin minus phase.
- `center` centers a pitch rail in the feasible interval and applies phase from
  that rail.
- Coverage is intentionally outside this first geometry kernel and remains an
  application policy.

## Containment and collision

- A positive roof margin produces a true polygon inset and may yield zero, one,
  or multiple usable components. An impossible inset returns `empty`; it never
  falls back to the original roof.
- A footprint may touch the effective roof boundary within the central metric
  tolerance, but may not cross it.
- Contact with a reserved polygon is a collision.
- Snow guards are segment obstacles with an explicit metric clearance.

The API is deliberately based on polygon footprints so a future placement unit
can represent one module or an assembled mounting block without changing the
containment and collision primitives.
