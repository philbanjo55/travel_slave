# Teton Sun Preview (concept demo)

A one-page 3D look at the Tetons from a few stops, lit by the calculated sun for 30 Dec 2026.
Built from our own elevation grid (`dem_region_rows`, region `grand_teton`), no Google data.

- `page.src.html`: the page. `/*__SUN__*/` is replaced by `sun.js`, `/*__DEM__*/` by the
  base64 of the elevation crop (little-endian int16, rows 153-487, columns 441-894 of the
  region grid: north edge 43.9505, west edge -110.92, 0.0015 deg steps, 335 x 454 points).
- Export the crop: `select r, cells[441:894] c from dem_region_rows where region='grand_teton'
  and r between 153 and 487 order by r`, pack as `<h`, base64.
- Shadows are marched across the grid per point (`vis`), so sun times are a few minutes off;
  the sun never counts before the flat-horizon sunrise.
