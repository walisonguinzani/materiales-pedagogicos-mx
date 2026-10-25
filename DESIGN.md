# Design: Educación de la Esperanza

World: the Kit Semillas de Esperanza's own printed page. Cream sheets with a double gold hairline frame lie on a warm paper table; watercolor stickers with a white die-cut edge carry color; olive ink for type.

## Color
- Mesa `#F3EEE0` (page) · Hoja `#FBF8EF` (sheets, cards) · Salvia claro `#E3E8D3` (alternate bands)
- Tinta `#2E3A1D` (headings, plan band, footer) · Oliva `#4B5B2D` (buttons, links) · Salvia `#7F9159` (checks, sprout)
- Oro `#C3A063` / Oro claro `#EADCBD` (frames, rules, seals) · Mostaza `#B97E12` (card titles, as on the Girasol cards)
- Texto `#2B3020` · Texto 2 `#59613F`

## Type
- Lora (self-hosted, OFL): headlines, card titles, quotes; italic only for one accent phrase and verses.
- Poppins 400/500/600 (self-hosted, OFL): body, buttons, wide-tracked small caps (month labels, verse references).

## Signature
The Girasol card in the hero: two sticker halves cover a folded panel, then swing open (CSS 3D + clip-path) to reveal "Levanta la mirada." and Salmos 121:1-2. Reduced motion shows it open. A button closes/reopens it.

## Components
- `.hoja`: cream sheet, 28px radius, double inset gold hairline frame, soft olive shadow.
- Year strip: gold rule with a dot per month, sticker, tracked month, Lora occasion; scroll-snap row on phones.
- Buttons: olive pill, cream text; outline pill in header.
- Covers: real kit/bonus covers, slightly rotated, with round gold "Regalo" seals.
