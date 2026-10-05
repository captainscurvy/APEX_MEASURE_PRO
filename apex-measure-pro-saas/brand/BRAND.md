# Apex Measure Pro — Brand Pass 1: "The Apex Point"

A new identity for the app, built fresh. Nothing from earlier Apex logos, drafts or
rebrand chapters is used.

## The idea

**The Apex Point.** A faceted peak, lit from the upper left like machined metal. At its
tip, a laser point glows. From the peak a dashed laser line drops onto a ruler marked in
**eighths of an inch** — the one rule the whole app is built on (every measurement is
floored to the nearest 1/8"). The mark says *peak precision* without a single word.

- Peak = "Apex" and the top of the trade.
- Laser point + plumb line = the DISTO laser, and the measurement being taken.
- The 1/8" scale = the product's promise: *measured to the eighth.*

Tone, from the rebrand log: bold and modern, minimal and elegant, warm and approachable,
high-tech, no AI slop.

## Palette

| Token | Hex | Role |
|---|---|---|
| Apex Night | `#0B1016` | App bar, hero ground, icon ground, primary buttons (light mode) |
| Night 2 / 3 | `#141B24` / `#1E2733` | Depth in the night ground |
| Bone | `#F3F1EC` | Text on night; primary buttons in dark mode |
| Steel | `#AEB6C1` | Secondary text on night |
| Laser | `#FF5A1F` | The apex point, the plumb line, the laser line under the app bar. **Artwork only.** |
| Signal (unchanged) | `#E14E0D` | ARMED state and live readings — still the only functional orange |
| Paper | `#F4F3F0` | Light-mode page (warm, approachable) |

No bronze, amber, gold, tan, brass, copper, ochre or mustard, and no chrome. Every
text pairing is contrast-tested in `tests/brand-contrast.test.js`.

## Type

**Archivo** (variable, SIL Open Font License), bundled in `fonts/` — works offline.
One family does everything, thanks to its width axis:

- Wordmark and labels: wide (125%) and heavy, letterspaced — engineered, confident.
- Measurements: 106% width, weight 750, **tabular numerals**, so readings never jitter.
- Body and buttons: normal width.

## Files

| File | Use |
|---|---|
| `brand/mark-on-dark.svg`, `mark-on-light.svg` | The mark alone |
| `brand/lockup-on-dark.svg`, `lockup-on-light.svg` | Mark + APEX / MEASURE PRO (letters are outlines — no font needed) |
| `brand/icon.svg`, `icon-maskable.svg` | Sources for `icons/*.png` |
| `brand/hero.svg` | Source for the home-screen hero; `brand/hero.webp` is what the app shows |

All are vector and scale to any size (print, van wrap, business card, site header).

---

## 3D render prompts (Gemini — Nano Banana Pro)

The artwork in the app is a vector illustration with lighting. For a true photoreal 3D
"wow" render, use **Gemini Nano Banana Pro** (`gemini-3-pro-image-preview`), per the
rebrand log's tool plan (Nano Banana 2 for cheap drafts first). DeepSeek is not a good fit:
its chat app does not generate images, and its open image model (Janus-Pro) is
low-resolution research software.

**Always attach `brand/mark-on-dark.svg` exported as PNG (or `brand/hero.webp`) as the
reference image**, so the model keeps the exact geometry instead of inventing a new logo.

### Prompt 1 — Home hero (aspect ratio 21:9)

> Photorealistic 3D render of a logo sculpture. Match the attached reference image's
> geometry exactly — do not redesign the shape. The sculpture is a sharp, faceted mountain
> peak shaped like an open "Λ" with a triangular notch cut out of its base (no crossbar),
> machined from satin bead-blasted aluminum with a solid back thickness and crisp 2 mm
> chamfered edges. The left face catches cool daylight and reads as bright satin silver;
> the right face falls into deep graphite shadow. At the very tip sits a tiny glowing laser
> point, saturated red-orange (#FF5A1F) with a soft bloom, like the dot of a laser distance
> meter. From the inside of the notch a thin dashed red-orange laser line drops straight
> down onto a precision ruler lying in front of the sculpture: a brushed-steel scale bar
> engraved with eight equal divisions, tall ticks at both ends, a medium tick in the
> center, short ticks between. A faint red-orange laser beam skims horizontally along the
> ruler's edge across the whole frame. Background: a deep graphite-blue studio void
> (#0B1016) with a barely visible technical blueprint grid, fading to near-black at the
> edges. One soft key light from the upper left, a thin cool rim light on the right edge,
> gentle contact shadow under the sculpture. Composition: sculpture and ruler occupy the
> left 40% of the frame; the right 55% is clean, empty negative space for text added later.
> Mood: precision instrument, premium, calm, engineered — like Leica or Mitutoyo product
> photography. No text, no letters, no numbers, no watermark, no people, no hands. No gold,
> brass, bronze or copper. No mirror chrome, no lens flares, no neon, no sci-fi HUD.

### Prompt 2 — App icon (aspect ratio 1:1)

> Photorealistic 3D render of the same logo sculpture from the attached reference: the
> faceted satin-aluminum "Λ" peak with the notched base, the glowing red-orange laser point
> at its tip, the dashed laser line dropping to the small brushed-steel eighth-inch ruler
> below. Straight-on front view, very slight top-down angle. Centered, filling about 60% of
> the frame, generous even margins on all sides (the icon will be cropped to a circle and a
> rounded square). Background: flat deep graphite-blue #0B1016 with a subtle radial glow
> behind the peak. Same lighting as a premium product shot: soft key from upper left, cool
> rim light. No text, no letters, no watermark, no gold, brass or bronze, no chrome mirror
> finish.

### Prompt 3 — Optional, for the website later (aspect ratio 16:9)

> Photograph-style scene: a professional installer's hand holding a compact laser distance
> meter against the inside corner of a white window frame in a bright modern living room;
> a small red-orange laser dot lands exactly on the opposite frame edge. Shallow depth of
> field, soft natural daylight, warm neutral tones, graphite and white color palette with
> the red-orange dot as the only accent. No brand names or logos visible on the device, no
> text, no gold or brass fixtures.

### Using the renders

- **Hero:** send me the 21:9 render. I'll set the APEX / MEASURE PRO wordmark on it, crop
  it to the app's 1600×760 hero, and save it as `brand/hero.webp`. Nothing else changes.
- **Icon:** send me the 1:1 render. I'll produce `icons/icon-192.png`, `icon-512.png` and
  the maskable version with safe margins.
- Keep the vector mark as the master logo. Renders are artwork *of* the logo, not a
  replacement for it.
