# Design

Visual reference: the "intelly" dashboard image supplied by the user (style only, not its clinic features).

## Visual language
- Warm cream background `#FBF6EC`, dark navigation bar `#111111`, pink accent `#E85D9A` for the active tab and main actions.
- Pastel cards with 22 px corners: yellow `#F6D96B` (results), pink `#F4B6D2` (band and live data),
  green `#B9C98A` (medication and measures), blue `#B8C7EE` (setup and checks), cream for contextual or secondary content.
- Bold black headings, short labels, numbers right-aligned in rows.
- Greeting header on Home ("Good evening, name") with a one-line status summary, as in the reference.

## Layout
Bottom navigation with six tabs: Home, Test, Live, Meds, Report, More. The reference's left sidebar became a
floating dark bar, which suits a phone screen.

## Honesty in the interface
- Provenance badges on every result: data source (Live wristband / Laptop simulator (SYNTHETIC) / In-app demo signal
  (SYNTHETIC)) and "MODEL · Training pipeline (confirmed)".
- The live monitor separates raw signal, calculated measures and model output into three cards.
- Contextual activities use a different card colour and the fixed "not validated" label.
- No red/green "good/bad" colouring of model classes, to avoid implying a diagnosis.
