# Apex Measure Pro — Higgsfield brief

Higgsfield is a paid, credits-based web service. It was not used to make anything in this repo;
this file is a ready-to-paste brief for the owner. Budget a few credits per take and expect to
generate each shot 3-5 times and keep the best.

## Rules that apply to every clip

**Reference images to attach (image-to-video / "start frame"):**
- `brand/renders/hero-3d-2400x1120.png` for style, lighting and the laser-dot look.
- `brand/renders/icon-3d-1024.png` for the mark's exact geometry (faceted peak, dashed line, ruler).
- Attach the hero render as the *style* reference on every shot so the palette stays consistent.

**Look:** deep graphite-blue night (#0B1016), satin aluminum, cool rim light, one warm accent: a
glowing orange-red laser point (#FF5A1F). Shallow depth of field, slow camera moves, 35-50 mm feel.

**Must not (paste this in the negative prompt / "avoid" field of every shot):**
- No brand logos on the phone, laser, tape, clothing, van or tools (no Apple/Samsung/Bosch/Leica/Disto/Stanley marks).
- No gold, bronze, brass, copper, amber or chrome. Metal is satin aluminum / graphite only.
- No on-screen text, captions, UI lettering, watermarks, numbers that must be readable.
  Phone and sheet screens should show abstract blurred rows only.
- No distorted hands or extra fingers (frame hands partly out of shot or in silhouette).
- No red/green laser beams across the room; the laser is a small dot and a thin dashed line only.

**Text and logo go in editing, not in the model.** Generative video garbles type and redraws logos.
Render clean plates, then add the wordmark, the headline, the "measured to the 1/8 inch" line and
the final lockup in the editor (CapCut / Premiere / DaVinci) with `brand/lockup-on-dark.svg`
(Archivo, Bone `#F3F1EC` text). Leave the right 40% (or lower third for 9:16) of every plate
uncluttered for overlays.

---

## A. Launch / promo video (15-20 s, 16:9, 1920x1080 or 4K)

Goal: the whole product story in one breath: measure, speak, sheet.

| # | Time | Shot | Prompt (paste) |
|---|------|------|----------------|
| 1 | 0-3 s | Hero sculpture | "Slow push-in on a faceted satin-aluminum peak sculpture on a dark graphite-blue studio floor with a faint grid, a small glowing orange laser point at its tip, thin dashed orange line dropping to a brushed-steel ruler, cool rim light, cinematic, shallow depth of field, premium product film." *(start frame: hero render)* |
| 2 | 3-7 s | Installer at the window | "Medium shot, installer in a dark work jacket (no logos) holding a handheld laser measure up to a tall residential window, bright orange laser dot on the white window frame, warm interior daylight, handheld documentary feel, shallow depth of field." |
| 3 | 7-11 s | Voice to phone | "Close shot over the shoulder, a phone held in a gloved hand, screen shows a clean dark interface with abstract rows filling in one by one, no readable text, soft backlight from the window, slow rack focus from the laser dot to the phone." |
| 4 | 11-15 s | The sheet appears | "Top-down shot on a tailgate, a clean white measurement sheet slides in and rows fill with abstract dark marks, pencil and tape measure beside it, cool morning light, no readable text." |
| 5 | 15-18 s | Back to the mark | "Return to the satin aluminum peak sculpture, the orange laser point pulses once and the dashed line lands on the ruler, camera drifts slightly right, empty dark space on the right." *(start frame: hero render)* |

Overlay in editing: shot 1 "Measure to the eighth." (wordmark lockup last 2 s on shot 5).
Aspect: 16:9. Generate 5-second takes per shot and cut together. Music: low, restrained, one rising tone at the laser pulse.

---

## B. Social clip 1: "Ladder call-out" (9:16, 8-10 s)

Installer on a ladder calling out measurements to the phone while the sheet appears.

- Shot list: (1) low angle, installer on a stepladder at a window, laser dot on the head rail, 3 s;
  (2) cutaway to the phone in the other hand, screen filling with abstract rows, 3 s;
  (3) split/insert: sheet sliding in beside the phone, 3 s.
- Prompt: "Vertical handheld shot, installer on a stepladder in a bright living room, holding a laser measure to the top of a window frame with an orange laser dot, speaking toward a phone in the other hand, natural light, documentary, faces slightly turned away, no logos, no readable text."
- Reference: hero render (style) + icon render (laser-dot colour).
- Overlay in editing: captions of the called-out numbers (tabular figures) and the sheet graphic, the real app screen recording composited on the phone if wanted.

## C. Social clip 2: "The dot lands" (1:1 or 9:16, 5-6 s)

The laser dot landing on a window frame.

- Shot list: (1) macro on the window frame edge, a thin orange dashed line travels down, 2 s;
  (2) the dot settles at the frame, subtle glow and bloom, 2 s; (3) pull back to reveal the full window, 2 s.
- Prompt: "Macro shot of a white window frame corner, a small glowing orange laser point lands on the frame edge with a soft bloom and a thin dashed line above it, shallow depth of field, dark interior, cool rim light, slow pull-back, premium product cinematography."
- Reference: both renders (the render shows exactly the dot and dash look).
- Overlay in editing: the lockup and "Measured to 1/8 inch." end card.

## D. Social clip 3: "Tape, voice, sheet" (9:16, 10-12 s)

Product story in three beats, one beat per ~3.5 s.

1. **Tape** — "Close shot of a hand pulling a silver-and-graphite tape measure across a window opening, no numbers readable, dark moody light."
2. **Voice** — "Same hand lifts a phone, a soft white waveform glow around the mic, no text, shallow depth of field."
3. **Sheet** — "A clean white measurement sheet fills with abstract dark rows on a clipboard, paper texture, cool light, no readable text."

- Reference: hero render for grade; keep tape colour silver/graphite (no yellow-gold tape, which reads as gold/bronze).
- Overlay in editing: "Tape. Voice. Sheet." as three title cards with the lockup at the end.

---

## Delivery checklist
- Export plates at the native aspect, no text, then composite type and the logo from `brand/*.svg`.
- Check every frame for gold/bronze casts and for invented logos before posting.
- Keep the laser dot the exact `#FF5A1F`: add it in post as a small glow layer if the model drifts to red or yellow.
