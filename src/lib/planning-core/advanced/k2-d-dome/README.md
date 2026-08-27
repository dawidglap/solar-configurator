# K2 D-Dome 6.10 Classic adapter

## Source

- System: K2 D-Dome 6.10 Classic
- Drawing: `07-481-08`
- Last change / approval date: `05.05.2023`
- Drawing units: millimetres
- Adapter version: `07-481-08@2023-05-05`

## Verified from the datasheet

- Module length: 1448-2390 mm.
- Module width: 950-1170 mm.
- The 140-450 mm dimension is the approximate service corridor.
- The 2086-2843 mm dimension is the approximate row space. It is the
  consequence of module projection, the 78 mm central dimension and service
  corridor limits; it is not validated as an independent global range.
- Effective-angle, assembly, service-corridor and block-size formulas are
  printed on sheet 2.
- Rail-direction block limit: 12 m. Long-module-side block limit: 16 m.
- Long-side repeat spacing: 18 mm, with 47 mm terminal extensions.

The drawing uses module width as the inclined dimension and module length along
the columns. Under the SOLA convention, the adapter supports `landscape` only.

## SOLA product interpretation

- Nominal tilt is 10 degrees; effective tilt is formula-derived.
- Default primary face azimuth is East (90 degrees); the opposite slot is always
  primary + 180 degrees.
- Slot 0 is the primary face on local +Y. Slot 1 is the opposite face on local
  -Y.
- The 78 mm central system dimension separates the two projected module
  footprints.
- One placement block contains exactly two modules and is validated as one
  collision footprint before expansion.
- `pitchY = rowSpaceM`; the difference between pitch and footprint is the
  service corridor.

The rail-direction footprint follows the official one-row block-size formula:
`2 x projected module depth + 78 mm`. The drawing also shows 20 mm minimum
terminal clearances, but the printed block-size formula does not add them. The
adapter therefore emits a technical warning and does not invent an extension.

## Not implemented

- Physical separation between Montagefelder: the drawing does not specify one,
  so deterministic grouping does not alter placement coordinates.
- Ballast, statics, wind/snow loads, fastening or structural verification.
- Optional hardware extensions or formulas from other K2 revisions.
