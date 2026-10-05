"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("./backend.js");

function proj(id, extra) { return Object.assign({ id: id, name: "Job " + id, client: "", date: "2026-10-05", rooms: [] }, extra); }
async function signIn(mock, email) {
  await mock.signInWithEmail(email);
  return mock.verifyCode(email, "123456");
}
async function rejects(p, code) {
  try { await p; } catch (e) { assert.equal(e.code, code, "expected " + code + " got " + e.code + " " + e.message); return e; }
  assert.fail("expected rejection " + code);
}
// owner + paid crew org + a second user who joined it
async function team(role) {
  const a = B.createMock();
  const b = B.createMock({ server: a.server });
  await signIn(a, "boss@x.com");
  a.server.setSubscription("boss@x.com", { plan: "crew", status: "active", seats: 3 });
  await signIn(b, "crew@x.com");
  const inv = await a.invite("crew@x.com", role || "member");
  await b.acceptInvite(inv.code);
  return { a, b };
}

test("mock: email code flow, wrong code rejected, session persisted via storage", async () => {
  const store = {}; const storage = { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } };
  const m = B.createMock();
  await m.signInWithEmail("a@x.com");
  await rejects(m.verifyCode("a@x.com", "999999"), "unauthorized");
  const s = await m.verifyCode("a@x.com", "123456");
  assert.equal(s.email, "a@x.com");
  assert.equal((await m.getEntitlement()).plan, "none");
  assert.equal((await m.getEntitlement()).role, "owner");
  await m.signOut();
  await rejects(m.getEntitlement(), "unauthorized");
  assert.equal(storage.getItem("x"), null);
});

test("mock: entitlement is server-derived from the subscription", async () => {
  const m = B.createMock();
  await signIn(m, "o@x.com");
  m.server.setSubscription("o@x.com", { plan: "crew", status: "trialing", seats: 5 });
  const e = await m.getEntitlement();
  assert.deepEqual([e.plan, e.status, e.seats], ["crew", "trialing", 5]);
  assert.ok(e.orgId);
});

test("mock: two users share an org; viewer reads but cannot write", async () => {
  const { a, b } = await team("viewer");
  await a.pushProject(proj("p1"));
  const got = await b.pullProjects("");
  assert.equal(got.length, 1);
  assert.equal(got[0].project.name, "Job p1");
  await rejects(b.pushProject(proj("p2")), "forbidden");
  await rejects(b.putPhoto("p1", "ph", new Blob(["x"])), "forbidden");
  assert.equal((await b.getEntitlement()).role, "viewer");
});

test("mock: optimistic concurrency → conflict; pull since cursor; soft delete", async () => {
  const { a, b } = await team("member");
  const r1 = await a.pushProject(proj("p1"));
  await rejects(a.pushProject(proj("p1")), "conflict");                   // no baseRev on existing row
  const r2 = await b.pushProject(proj("p1", { name: "B edit" }), { baseRev: r1.rev });
  await rejects(a.pushProject(proj("p1", { name: "A edit" }), { baseRev: r1.rev }), "conflict");
  assert.equal((await a.pullProjects(r1.rev))[0].project.name, "B edit");
  assert.equal((await a.pullProjects(r2.rev)).length, 0);
  await a.deleteProject("p1");
  const t = await b.pullProjects(r2.rev);
  assert.equal(t[0].deleted, true);
});

test("mock: pushing needs an active Crew plan (server-enforced)", async () => {
  const m = B.createMock();
  await signIn(m, "solo@x.com");
  await rejects(m.pushProject(proj("p")), "forbidden");
  m.server.setSubscription("solo@x.com", { plan: "manual", status: "active", seats: 1 });
  await rejects(m.pushProject(proj("p")), "forbidden");
});

test("mock: seat limit counts paid seats + pending invites; viewers are free", async () => {
  const a = B.createMock();
  await signIn(a, "boss@x.com");
  a.server.setSubscription("boss@x.com", { plan: "crew", status: "active", seats: 2 });
  await a.invite("one@x.com", "member");
  const e = await rejects(a.invite("two@x.com", "member"), "forbidden");
  assert.equal(e.detail, "seat-limit");
  await a.invite("office@x.com", "viewer");     // free
  await a.invite("office2@x.com", "viewer");
});

test("mock: invite is email-bound, single-use; members cannot invite; owner cannot be removed", async () => {
  const { a, b } = await team("member");
  await rejects(b.invite("z@x.com", "member"), "forbidden");
  const c = B.createMock({ server: a.server });
  await signIn(c, "other@x.com");
  const inv = await a.invite("someone@x.com", "member");
  const e = await rejects(c.acceptInvite(inv.code), "forbidden");
  assert.equal(e.detail, "email-mismatch");
  await rejects(c.acceptInvite("NOPE"), "forbidden");
  const members = await a.listMembers();
  const owner = members.filter((m) => m.role === "owner")[0];
  await rejects(a.removeMember(owner.userId), "forbidden");
});

test("mock: setRole / removeMember; removed user gets a fresh personal org", async () => {
  const { a, b } = await team("member");
  const crew = (await a.listMembers()).filter((m) => m.email === "crew@x.com")[0];
  await a.setRole(crew.userId, "viewer");
  assert.equal((await b.getEntitlement()).role, "viewer");
  await a.removeMember(crew.userId);
  const e = await b.getEntitlement();
  assert.equal(e.role, "owner");
  assert.equal(e.plan, "none");
  assert.equal((await a.listMembers()).length, 1);
});

test("mock: cannot join a team while holding your own active plan", async () => {
  const a = B.createMock(); const b = B.createMock({ server: a.server });
  await signIn(a, "boss@x.com");
  a.server.setSubscription("boss@x.com", { plan: "crew", status: "active", seats: 3 });
  await signIn(b, "paid@x.com");
  b.server.setSubscription("paid@x.com", { plan: "manual", status: "active", seats: 1 });
  const inv = await a.invite("paid@x.com", "member");
  const e = await rejects(b.acceptInvite(inv.code), "forbidden");
  assert.equal(e.detail, "cancel-plan-first");
});

test("mock: offline and failNext surface codes", async () => {
  const m = B.createMock();
  await signIn(m, "o@x.com");
  m.setOnline(false);
  await rejects(m.getEntitlement(), "offline");
  m.setOnline(true);
  m.failNext("server");
  await rejects(m.getEntitlement(), "server");
  assert.ok(await m.getEntitlement());
});

// ---------- real HTTP client against a scripted fetch ----------

function fakeFetch(handler) {
  const log = [];
  const f = async (url, init) => {
    init = init || {};
    log.push({ url, method: init.method || "GET", headers: init.headers || {}, body: init.body });
    const r = await handler(url, init, log.length);
    return {
      status: r.status, ok: r.status < 200 || r.status >= 300 ? false : true,
      text: async () => (r.body === undefined ? "" : typeof r.body === "string" ? r.body : JSON.stringify(r.body)),
      blob: async () => new Blob([r.body || ""])
    };
  };
  f.log = log;
  return f;
}
function mkStorage() { const d = {}; return { d, getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = v; }, removeItem: (k) => { delete d[k]; } }; }
const CFG = { demo: false, backend: { url: "https://x.supabase.co", anonKey: "anon-public" } };
const tokenBody = (n, exp) => ({ access_token: "at" + n, refresh_token: "rt" + n, expires_in: 3600, expires_at: exp, user: { id: "u1", email: "a@x.com" } });

test("http: not-configured when url/anonKey empty (demo)", async () => {
  const b = B.createBackend({ config: { demo: true, backend: { url: "", anonKey: "" } }, storage: mkStorage() });
  assert.equal(b.configured(), false);
  await rejects(b.signInWithEmail("a@x.com"), "not-configured");
  await rejects(b.getEntitlement(), "unauthorized");
});

test("http: OTP request, verify, session persisted, bearer on RPC", async () => {
  const st = mkStorage();
  const f = fakeFetch((url, init) => {
    if (url.endsWith("/auth/v1/otp")) return { status: 200, body: {} };
    if (url.endsWith("/auth/v1/verify")) return { status: 200, body: tokenBody(1, Math.floor(Date.now() / 1000) + 3600) };
    if (url.endsWith("/rest/v1/rpc/get_entitlement")) return { status: 200, body: { plan: "crew", status: "active", seats: 3, orgId: "o1", role: "owner", currentPeriodEnd: null } };
    return { status: 500, body: {} };
  });
  const b = B.createBackend({ config: CFG, fetch: f, storage: st });
  await b.signInWithEmail("a@x.com");
  assert.equal(JSON.parse(f.log[0].body).create_user, true);
  assert.equal(f.log[0].headers.apikey, "anon-public");
  const s = await b.verifyCode("a@x.com", " 123456 ");
  assert.equal(JSON.parse(f.log[1].body).token, "123456");
  assert.equal(s.userId, "u1");
  assert.ok(st.d[B.SESSION_KEY]);
  const e = await b.getEntitlement();
  assert.equal(e.plan, "crew");
  assert.equal(f.log[2].headers.Authorization, "Bearer at1");
  // a fresh instance restores the session from storage
  const b2 = B.createBackend({ config: CFG, fetch: f, storage: st });
  assert.equal(b2.session().email, "a@x.com");
  await b2.signOut();
  assert.equal(st.d[B.SESSION_KEY], undefined);
});

test("http: expired token auto-refreshes before the call; 401 triggers one refresh+retry", async () => {
  const st = mkStorage();
  st.setItem(B.SESSION_KEY, JSON.stringify({ userId: "u1", email: "a@x.com", accessToken: "old", refreshToken: "rt0", expiresAt: Date.now() - 1000 }));
  let ent401 = true;
  const f = fakeFetch((url) => {
    if (url.indexOf("grant_type=refresh_token") !== -1) return { status: 200, body: tokenBody(2, Math.floor(Date.now() / 1000) + 3600) };
    if (url.endsWith("get_entitlement")) {
      if (ent401) { ent401 = false; return { status: 401, body: { message: "JWT expired" } }; }
      return { status: 200, body: { plan: "manual", status: "active", seats: 1, orgId: "o1", role: "owner" } };
    }
    return { status: 500, body: {} };
  });
  const b = B.createBackend({ config: CFG, fetch: f, storage: st });
  const e = await b.getEntitlement();
  assert.equal(e.plan, "manual");
  const refreshes = f.log.filter((l) => l.url.indexOf("refresh_token") !== -1).length;
  assert.equal(refreshes, 2);                       // once because expired, once after the 401
  assert.equal(JSON.parse(f.log[0].body).refresh_token, "rt0");
});

test("http: dead refresh token signs out → unauthorized; network failure keeps the session → offline", async () => {
  const st = mkStorage();
  st.setItem(B.SESSION_KEY, JSON.stringify({ userId: "u1", email: "a@x.com", accessToken: "old", refreshToken: "rt0", expiresAt: 1 }));
  let mode = "net";
  const f = async (url) => {
    if (mode === "net") throw new TypeError("Failed to fetch");
    return { status: 400, text: async () => JSON.stringify({ error: "invalid_grant" }) };
  };
  const b = B.createBackend({ config: CFG, fetch: f, storage: st });
  await rejects(b.getEntitlement(), "offline");
  assert.ok(b.session());
  mode = "dead";
  await rejects(b.getEntitlement(), "unauthorized");
  assert.equal(b.session(), null);
});

function authedBackend(handler, role) {
  const st = mkStorage();
  st.setItem(B.SESSION_KEY, JSON.stringify({ userId: "u1", email: "a@x.com", accessToken: "at", refreshToken: "rt", expiresAt: Date.now() + 3600000 }));
  const f = fakeFetch((url, init, n) => {
    if (url.endsWith("get_entitlement")) return { status: 200, body: { plan: "crew", status: "active", seats: 3, orgId: "org-1", role: role || "member" } };
    return handler(url, init, n);
  });
  return { b: B.createBackend({ config: CFG, fetch: f, storage: st }), f };
}

test("http: pushProject — insert, 409 → conflict; baseRev update, 0 rows → conflict vs forbidden", async () => {
  let h = (url, init) => (init.method === "POST" ? { status: 201, body: [{ id: "p1", updated_at: "2026-10-05T10:00:00.123456+00:00" }] } : { status: 500 });
  let { b, f } = authedBackend((u, i) => h(u, i));
  const r = await b.pushProject(proj("p1"));
  assert.equal(r.rev, "2026-10-05T10:00:00.123456+00:00");
  const ins = f.log[f.log.length - 1];
  assert.match(ins.url, /\/rest\/v1\/projects\?select=/);
  assert.equal(JSON.parse(ins.body).org_id, "org-1");
  assert.equal(ins.headers.Prefer, "return=representation");

  h = () => ({ status: 409, body: { code: "23505", message: "duplicate key" } });
  await rejects(b.pushProject(proj("p1")), "conflict");

  // baseRev: PATCH returns [] ; the follow-up GET shows a different rev → conflict
  h = (url, init) => {
    if (init.method === "PATCH") return { status: 200, body: [] };
    return { status: 200, body: [{ updated_at: "NEWER" }] };
  };
  await rejects(b.pushProject(proj("p1"), { baseRev: "2026-10-05T10:00:00.123456+00:00" }), "conflict");
  const patch = f.log.filter((l) => l.method === "PATCH").pop();
  assert.ok(patch.url.indexOf("updated_at=eq.2026-10-05T10%3A00%3A00.123456%2B00%3A00") !== -1, patch.url);
  // same rev still there but PATCH touched nothing → RLS said no
  h = (url, init) => (init.method === "PATCH" ? { status: 200, body: [] } : { status: 200, body: [{ updated_at: "BASE" }] });
  await rejects(b.pushProject(proj("p1"), { baseRev: "BASE" }), "forbidden");
});

test("http: viewer is stopped client-side; RLS 403 → forbidden; 5xx → server", async () => {
  const viewer = authedBackend(() => ({ status: 500 }), "viewer");
  await rejects(viewer.b.pushProject(proj("p1")), "forbidden");
  assert.equal(viewer.f.log.filter((l) => l.url.indexOf("/projects") !== -1).length, 0);
  const { b } = authedBackend(() => ({ status: 403, body: { message: "new row violates row-level security policy" } }));
  await rejects(b.pushProject(proj("p1")), "forbidden");
  const s5 = authedBackend(() => ({ status: 503, body: {} }));
  await rejects(s5.b.pullProjects(""), "server");
});

test("http: pullProjects pages and maps rows", async () => {
  const rows = (n, base) => Array.from({ length: n }, (_, i) => ({ id: "p" + (base + i), data: proj("p" + (base + i)), updated_at: "2026-10-05T10:00:" + String(base + i).padStart(2, "0") + "+00:00", deleted_at: null, owner_id: "u9" }));
  let call = 0;
  const { b, f } = authedBackend((url) => { call++; return { status: 200, body: call === 1 ? rows(500, 10) : rows(2, 90) }; });
  const out = await b.pullProjects("2026-10-01T00:00:00+00:00");
  assert.equal(out.length, 502);
  assert.equal(out[0].rev.slice(0, 10), "2026-10-05");
  const pages = f.log.filter((l) => l.url.indexOf("/projects?") !== -1);
  assert.equal(pages.length, 2);
  assert.ok(pages[1].url.indexOf("updated_at=gt.") !== -1);
});

test("http: RPC error from the server (PT403 seat-limit) → forbidden with detail", async () => {
  const { b } = authedBackend(() => ({ status: 403, body: { code: "PT403", message: "seat-limit" } }));
  const e = await rejects(b.invite("a@b.co", "member"), "forbidden");
  assert.equal(e.detail, "seat-limit");
});

test("http: photos use the org/project/photo storage path", async () => {
  const { b, f } = authedBackend((url, init) => (init.method === "POST" ? { status: 200, body: { Key: "k" } } : { status: 200, body: "bytes" }));
  await b.putPhoto("p1", "ph1", new Blob(["x"], { type: "image/jpeg" }));
  const up = f.log.filter((l) => l.url.indexOf("/storage/") !== -1)[0];
  assert.equal(up.url, "https://x.supabase.co/storage/v1/object/photos/org-1/p1/ph1");
  assert.equal(up.headers["Content-Type"], "image/jpeg");
  const blob = await b.getPhoto("p1", "ph1");
  assert.ok(blob.size > 0);
  assert.match(f.log[f.log.length - 1].url, /object\/authenticated\/photos\/org-1\/p1\/ph1$/);
});

test("mock: consent log, tombstoned deletes, owner can't leave a populated team, past_due grace", async () => {
  const { a, b } = await team("member");
  await a.recordConsent("2026-10", "2026-10");
  assert.equal(a.server.consents.length, 1);
  await rejects(a.recordConsent("", "x"), "server");
  await a.pushProject(proj("p1", { client: "secret" }));
  await a.deleteProject("p1");
  const rec = (await b.pullProjects(""))[0];
  assert.equal(rec.deleted, true);
  assert.deepEqual(rec.project, { id: "p1" });
  // boss (owner with a teammate) cannot join another org
  const o = B.createMock({ server: a.server });
  await signIn(o, "other@x.com");
  o.server.setSubscription("other@x.com", { plan: "crew", status: "active", seats: 3 });
  const inv = await o.invite("boss@x.com", "member");
  const e = await rejects(a.acceptInvite(inv.code), "forbidden");
  assert.equal(e.detail, "transfer-ownership-first");
  // past_due: ok within 7 days of period end, not after
  const orgId = Object.keys(a.server.subs)[0];
  a.server.subs[orgId].status = "past_due";
  a.server.subs[orgId].currentPeriodEnd = new Date(Date.now() - 2 * 86400000).toISOString();
  await a.pushProject(proj("p2"));
  a.server.subs[orgId].currentPeriodEnd = new Date(Date.now() - 9 * 86400000).toISOString();
  await rejects(a.pushProject(proj("p3")), "forbidden");
});

test("?mock=1 only activates on localhost / file://, never on a production hostname", () => {
  const path = require.resolve("./backend.js");
  function load(loc) {
    const prev = globalThis.location;
    globalThis.location = loc;
    delete require.cache[path];
    try { return require("./backend.js"); } finally { globalThis.location = prev; delete require.cache[path]; }
  }
  assert.equal(load({ hostname: "app.apexinstallationsok.com", protocol: "https:", search: "?mock=1" }).isMock, false);
  assert.equal(load({ hostname: "localhost", protocol: "http:", search: "?mock=1" }).isMock, true);
  assert.equal(load({ hostname: "127.0.0.1", protocol: "http:", search: "?x=1&mock=1" }).isMock, true);
  assert.equal(load({ hostname: "", protocol: "file:", search: "?mock=1" }).isMock, true);
  assert.equal(load({ hostname: "localhost", protocol: "http:", search: "" }).isMock, false);
  assert.equal(load({ hostname: "evil.example", protocol: "https:", search: "?mock=1" }).configured(), false);
});
