# K2 reference documents

This note records the versioned source material approved for future geometry work. It does not implement K2 geometry and is not a substitute for the original drawings.

All dimensions in the two system data sheets are expressed in millimetres.

## D-Dome 6.10 Classic

- Document: `System data sheet_D-Dome 6.10 Classic.pdf`
- Drawing: `07-481-08`
- Approved / last changed: `05.05.2023`
- Sheets: 2, A3
- Future use: module-width-derived effective angle, assembly dimensions 1 and 2, service corridor, block size in rail direction and block size along the module long side.
- Formula dependencies identified by the drawing: module width, module length, row space, number of rows and number of columns.
- The effective angle is derived from module width; it must not be assumed to equal the nominal commercial tilt for every allowed module.
- The drawing defines separate relationships for assembly dimension 2 and service corridor for the double-sided D-Dome arrangement.

Formula inventory from sheet 2, normalized to decimal points:

- `x = asin(164.5 / (moduleWidth - 40))`
- `assemblyDimension1 = (moduleWidth - 40) * cos(x) - 23.5 - 55.7 + 3.6`
- `assemblyDimension2 = rowSpace - 2 * (moduleWidth * cos(x) - 23.5) - 78`
- `serviceCorridor = assemblyDimension2 - 2 * 23.5`
- `blockSizeRail = rowSpace * rowCount - serviceCorridor`
- `blockSizeLongSide = (moduleLength + 18) * columnCount - 18 + 2 * 47`

## S-Dome 6.10 Classic

- Document: `System data sheet_S-Dome 6.10 Classic.pdf`
- Drawing: `07-482-05`
- Approved / last changed: `05.05.2023`
- Sheets: 2, A3
- Future use: module-width-derived effective angle, assembly dimensions 1 and 2, service corridor, block size in rail direction and block size along the module long side.
- Formula dependencies identified by the drawing: module width, module length, row space, number of rows and number of columns.
- The S-Dome assembly-dimension, service-corridor and rail-direction block-size relations differ from the D-Dome relations and require a separate mounting-system adapter.

Formula inventory from sheet 2, normalized to decimal points:

- `x = asin(164.5 / (moduleWidth - 40))`
- `assemblyDimension1 = (moduleWidth - 40) * cos(x) - 23.5 - 55.7 + 3.6`
- `assemblyDimension2 = rowSpace - moduleWidth * cos(x) - 38.7 + 23.5`
- `serviceCorridor = rowSpace - moduleWidth * cos(x)`
- `blockSizeRail = rowSpace * rowCount - serviceCorridor + 38.7 + 20`
- `blockSizeLongSide = (moduleLength + 18) * columnCount - 18 + 2 * 47`

## K2 Product Brochure DE

- Document: `Product-Brochure-de.pdf`
- Version: `Produkt Broschuere DE V4 | 0326`
- Future use: commercial system capabilities and supported arrangement families only; it is not an authoritative source for dimensional formulas.
- Dome 6 capability stated: 10 or 15 degree elevation and South or East-West arrangements; Dome 6 Classic supports flexible row spacing / maintenance corridors.
- GreenRoof Vento capability stated: portrait or landscape modules, 10 or 15 degree elevation, S/A/V geometry families and variable row spacing including East-West arrangements.

## Missing dimensional source

No GreenRoof Vento system data sheet with dimensional formulas has been supplied. Future domain types may reserve GreenRoof and underside-clearance concepts, but accurate GreenRoof placement geometry must not be implemented from the brochure alone.

## Usage rule for future phases

- Keep each mounting-system preset tied to document identity, drawing number and revision.
- Derive geometry from the system-specific formulas and module dimensions; do not use a universal block depth.
- Keep nominal tilt and geometry-derived effective tilt as separate values.
- Do not copy these formulas into separate frontend and backend implementations; both consumers must eventually use the same pure TypeScript Planning Core.
