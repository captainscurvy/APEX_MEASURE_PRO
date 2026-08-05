// POST { email } -> { ok:true, jobs:[...] } | 403
// Returns the subscriber's saved job-history summaries, most recent first.
const { getStore } = require("@netlify/blobs");
const { verifyAccess } = require("./_verify");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "method_not_allowed" }) };

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (_) {
    return { statusCode: 400, body: JSON.stringify({ error: "bad_request" }) };
  }

  const { email } = body;
  const result = await verifyAccess({ email });
  if (!result.active) return { statusCode: 403, body: JSON.stringify({ error: "inactive" }) };

  const key = String(email).trim().toLowerCase();
  try {
    const store = getStore("job-history");
    const existing = (await store.get(key, { type: "json" })) || [];
    const arr = Array.isArray(existing) ? existing : [];
    const jobs = arr.slice().reverse(); // most recent first
    return { statusCode: 200, body: JSON.stringify({ ok: true, jobs }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "storage_error" }) };
  }
};
