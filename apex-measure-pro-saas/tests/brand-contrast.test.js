// Brand layer contrast: base tokens.css with css/brand.css layered on top, per theme.
// Run: node --test   — re-run after changing any brand token.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", "css", f), "utf8");
function block(css, re) {
  const m = re.exec(css);
  if (!m) return {};
  const start = css.indexOf("{", m.index) + 1;
  const body = css.slice(start, css.indexOf("}", start));
  const out = {};
  for (const [, k, v] of body.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})\b/g)) out[k] = v;
  return out;
}
const LIGHT = /:root,\s*\[data-theme="light"\]\s*\{/;
const DARK_MEDIA = /:root:not\(\[data-theme="light"\]\)\s*\{/;
const DARK_MANUAL = /:root\[data-theme="dark"\]\s*\{/;
const base = read("tokens.css"), brand = read("brand.css");
const light = { ...block(base, LIGHT), ...block(brand, LIGHT) };
const darkMedia = { ...light, ...block(base, DARK_MEDIA), ...block(brand, DARK_MEDIA) };
const darkManual = { ...light, ...block(base, DARK_MANUAL), ...block(brand, DARK_MANUAL) };

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function hue(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return null;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

test("manual dark toggle and system dark are identical", () => {
  assert.deepEqual(darkManual, darkMedia);
});

for (const [name, t] of [["light", light], ["dark", darkMedia]]) {
  test(name + ": body text passes AA 4.5:1", () => {
    for (const fg of ["ink", "ink-2", "ink-3", "signal-ink", "good", "bad"]) {
      for (const bg of ["paper", "surface", "surface-2"]) {
        const r = ratio(t[fg], t[bg]);
        assert.ok(r >= 4.5, `${name} --${fg} on --${bg} = ${r.toFixed(2)}`);
      }
    }
    for (const [fg, bg] of [["ink-2", "surface-3"], ["ink", "surface-3"], ["signal-ink", "signal-wash"],
                            ["ink", "signal-wash"], ["bad", "bad-wash"], ["on-fill", "bad"],
                            ["primary-ink", "primary-top"], ["primary-ink", "primary-bot"],
                            ["brand-ink", "brand-bar"], ["brand-ink-2", "brand-bar"], ["brand-ink", "brand-night-2"]]) {
      const r = ratio(t[fg], t[bg]);
      assert.ok(r >= 4.5, `${name} --${fg} on --${bg} = ${r.toFixed(2)}`);
    }
  });
  test(name + ": graphical accents pass 3:1", () => {
    assert.ok(ratio(t.signal, t.paper) >= 3, "signal on paper");
    assert.ok(ratio(t.laser, t["brand-bar"]) >= 3, "laser line on the app bar");
  });
  test(name + ": no forbidden hues (bronze, amber, gold, tan, ochre…)", () => {
    for (const k of ["signal", "signal-ink", "bad", "good", "laser"]) {
      const h = hue(t[k]);
      assert.ok(h < 30 || (h > 90 && h < 180), `--${k} ${t[k]} hue ${h}`);
    }
  });
}

test("brand.css hardcodes no colour outside its token blocks", () => {
  const rules = brand.slice(brand.indexOf("/* ================= components"));
  assert.doesNotMatch(rules, /#[0-9A-Fa-f]{3,8}\b|rgba?\(/);
});
