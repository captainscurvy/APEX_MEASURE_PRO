// POST { email, deviceId?, previewTier? } -> { active, status, tier, isAdmin }
//
// Admin bypass (see _verify.js) always wins and is never device-capped.
// Real subscribers are capped at 5 distinct devices per email per 30 days,
// tracked in Netlify Blobs — a 6th distinct device returns
// { active:false, status:"device_limit" } without calling Stripe again.
const { getStore } = require("@netlify/blobs");
const { verifyAccess } = require("../lib/verify");

const DEVICE_CAP = 5;
const DEVICE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

async function checkDeviceCap(email, deviceId) {
  if (!deviceId) return { ok: true }; // no deviceId supplied — don't block, just don't track
  try {
    const store = getStore("device-tracking");
    const key = email;
    const now = Date.now();
    const raw = await store.get(key, { type: "json" });
    const entries = Array.isArray(raw) ? raw.filter((e) => now - e.lastSeen <= DEVICE_WINDOW_MS) : [];
    const existing = entries.find((e) => e.deviceId === deviceId);
    if (existing) {
      existing.lastSeen = now;
      await store.setJSON(key, entries);
      return { ok: true };
    }
    if (entries.length >= DEVICE_CAP) {
      return { ok: false };
    }
    entries.push({ deviceId, lastSeen: now });
    await store.setJSON(key, entries);
    return { ok: true };
  } catch (_) {
    return { ok: true }; // Blobs unavailable — fail open on the device cap only, never on the subscription check itself
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ active: false, status: "error" }) };
  }
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (_) {
    return { statusCode: 400, body: JSON.stringify({ active: false, status: "error" }) };
  }

  const { email, deviceId, previewTier } = body;
  const result = await verifyAccess({ email, previewTier });

  if (result.active && !result.isAdmin) {
    const cap = await checkDeviceCap(String(email).trim().toLowerCase(), deviceId);
    if (!cap.ok) {
      return { statusCode: 200, body: JSON.stringify({ active: false, status: "device_limit", tier: null, isAdmin: false }) };
    }
  }

  return { statusCode: 200, body: JSON.stringify(result) };
};
