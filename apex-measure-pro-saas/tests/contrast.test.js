// §11.3 — measured contrast, re-run on any token change. Run: node --test
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "..", "css", "tokens.css"), "utf8");

function block(selectorRe) {
  const m = selectorRe.exec(css);
  assert.ok(m, "token block not found: " + selectorRe);
  const start = css.indexOf("{", m.index) + 1;
  const body = css.slice(start, css.indexOf("}", start));
  const out = {};
  for (const [, k, v] of body.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})/g)) out[k] = v;
  return out;
}
const light = block(/:root,\s*\[data-theme="light"\]\s*\{/);
const dark = { ...light, ...block(/:root\[data-theme="dark"\]\s*\{/) };
const darkMedia = { ...light, ...block(/:root:not\(\[data-theme="light"\]\)\s*\{/) };

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test("dark blocks are identical (media query and manual toggle)", () => {
  assert.deepEqual(dark, darkMedia);
});

for (const [name, t] of [["light", light], ["dark", dark]]) {
  test(name + ": text tokens pass AA 4.5:1 on paper and surface", () => {
    for (const fg of ["ink", "ink-2", "ink-3", "signal-ink", "good", "bad"]) {
      for (const bg of ["paper", "surface"]) {
        const r = ratio(t[fg], t[bg]);
        assert.ok(r >= 4.5, `${name} --${fg} on --${bg} = ${r.toFixed(2)}`);
      }
    }
    assert.ok(ratio(t["signal-ink"], t["signal-wash"]) >= 4.5, "signal-ink on signal-wash");
    assert.ok(ratio(t["bad"], t["bad-wash"]) >= 4.5, "bad on bad-wash");
    assert.ok(ratio(t["ink"], t["signal-wash"]) >= 4.5, "ink on signal-wash (armed value)");
  });
  test(name + ": graphical --signal passes 3:1; fills carry readable text", () => {
    assert.ok(ratio(t.signal, t.paper) >= 3, "signal on paper");
    assert.ok(ratio(t["on-fill"], t.bad) >= 4.5, "on-fill on bad");
    assert.ok(ratio(t.paper, t.ink) >= 4.5, "paper on ink (primary button)");
  });
}

test("spec-measured values (§11.3)", () => {
  assert.equal(ratio(light.ink, light.paper).toFixed(2), "16.04");
  assert.equal(ratio(light["ink-3"], light.paper).toFixed(2), "4.57");
  assert.equal(ratio(light.signal, light.paper).toFixed(2), "3.57");
});

test("no forbidden hues: every accent is red-orange, green or red", () => {
  // Hue of each accent; bronze/amber/gold/tan/ochre live around 30°–60°.
  function hue(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (!d) return null;
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  }
  for (const t of [light, dark]) {
    for (const k of ["signal", "signal-ink", "bad", "good"]) {
      const h = hue(t[k]);
      assert.ok(h < 30 || (h > 90 && h < 180), `--${k} ${t[k]} hue ${h}`);
    }
  }
});
