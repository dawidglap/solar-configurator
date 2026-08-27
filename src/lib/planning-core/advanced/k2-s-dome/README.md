# K2 S-Dome 6.10 Classic adapter

## Source

- System: K2 S-Dome 6.10 Classic
- Drawing: `07-482-05`
- Last change / approval date: `05.05.2023`
- Drawing units: millimetres
- Adapter version: `07-482-05@2023-05-05`

## Verified from the datasheet

- Module length: 1448-2390 mm.
- Module width: 950-1170 mm.
- Row space: 1150-2000 mm.
- The effective-angle, assembly-dimension, service-corridor and block-size
  formulas implemented in `formulas.ts` are printed on sheet 2.
- Modules repeat by 18 mm along their long side, with 47 mm terminal extensions.
- The minimum low-side terminal extension is 20 mm; the high-side extension
  used by the rail-direction block-size formula is 38.7 mm.
- Maximum continuous field dimensions: 12 m in rail direction and 15 m
  towards the module long side (plan view, drawing 07-482-05).
- Detail Y shows 200 mm between separated BasicRail sections. This is a rail
  break detail, not a module-grid pitch or an instruction to move modules;
  Montagefeld grouping therefore does not alter placement coordinates.

The drawing uses module width as the inclined dimension and module length along
the columns. Under the SOLA module convention this adapter therefore supports
`landscape` orientation only.

## Product interpretation

- Nominal product tilt is 10 degrees.
- Effective tilt is always derived from the K2 formula.
- Default face azimuth is geographic South (180 degrees), but remains
  configurable.
- `rowSpaceM` is the only row-pitch input. Service corridor and assembly
  dimension 2 are derived from it.

The module projected footprint describes only the plan projection of the PV
module. The block footprint is the minimum 1-row x 1-column system envelope
obtained from the two official block-size formulas. It adds 47 mm on each long
side and the documented 20 mm minimum / 38.7 mm terminal rail extents in the
rail direction. The grid pitches are `module length + 18 mm` and `rowSpaceM`.

## Not implemented

- Optional hardware extensions beyond the minimum documented envelope.
- Ballast, statics, wind/snow loads, fastening or structural verification.
- Physical mounting/rail segmentation beyond deterministic Montagefeld grouping.
- Any formula from a different K2 system or datasheet revision.
