# Station-style PDF layout

## Goal
Make the **Download PDF** report follow the same visual organization as each station board instead of using a plain cross-station table.

## Changes
- Give every station its own clearly separated report section, with the station name and completion summary at the top.
- Render categories in their saved order with distinct colored headers, matching the station board's grouped layout.
- Render each item as a station-style row showing its name, shelf/container details, quality specification, and status for every configured shift.
- Show corrective notes directly below flagged items so they remain connected to the affected item.
- Include saved category temperatures and station comments when available.
- Keep automatic page breaks so large stations and long user-uploaded templates remain readable without clipped text.
- Keep the existing dashboard button and filename behavior.

## Technical details
- Update the existing browser-side PDF generator only; no data model or cloud changes.
- Read the same station structures, daily entries, shifts, temperature values, and comments already used by the station page.
- Use a compact A4 landscape layout, colored status badges, repeating station/category context after page breaks, and a final all-stations summary.
- Validate the generated PDF visually with sample station data and inspect every rendered page for clipping or overlap.
