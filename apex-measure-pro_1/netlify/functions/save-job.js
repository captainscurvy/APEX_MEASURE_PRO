// POST { email, deviceId, jobSummary } -> { ok:true } | 403
// Called client-side right after a successful priced export. Never for the
// blank template. Independently re-verifies the subscription — never trusts
// the client. Purely additive: does not touch capture/export/gating logic.
const { getStore } = require("@netlify/blobs");
const { verifyAccess } = require("./_verify");

const MAX_HISTORY = 200;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "method_not_allowed" }) };

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (_) {
    return { statusCode: 400, body: JSON.stringify({ error: "bad_request" }) };
  }

  const { email, jobSummary } = body;
  const result = await verifyAccess({ email });
  if (!result.active) return { statusCode: 403, body: JSON.stringify({ error: "inactive" }) };
  if (!jobSummary || typeof jobSummary !== "object") return { statusCode: 400, body: JSON.stringify({ error: "bad_request" }) };

  const key = String(email).trim().toLowerCase();
  try {
    const store = getStore("job-history");
    const existing = (await store.get(key, { type: "json" })) || [];
    const arr = Array.isArray(existing) ? existing : [];
    arr.push({
      jobName: String(jobSummary.jobName || "Untitled job").slice(0, 200),
      date: new Date().toISOString(),
      roomCount: Number(jobSummary.roomCount) || 0,
      roomNames: Array.isArray(jobSummary.roomNames) ? jobSummary.roomNames.slice(0, 50).map((s) => String(s).slice(0, 60)) : [],
    });
    while (arr.length > MAX_HISTORY) arr.shift(); // cap oldest-first
    await store.setJSON(key, arr);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "storage_error" }) };
  }
};
