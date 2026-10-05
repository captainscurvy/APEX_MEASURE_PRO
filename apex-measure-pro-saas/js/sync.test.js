"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("./backend.js");
const Sync = require("./sync.js");
const S = require("./store.js");

// ---- harness -----------------------------------------------------------------------

function memStore() {
  const projects = new Map(), photos = new Map(), kv = new Map();
  const c = (x) => JSON.parse(JSON.stringify(x));
  return {
    projects, photos,
    listProjects: async () => Array.from(projects.values()).map(c),
    getProject: async (id) => (projects.has(id) ? c(projects.get(id)) : null),
    saveProject: async (p) => { projects.set(p.id, c(p)); },
    deleteLocal: (id) => projects.delete(id),
    getPhoto: async (id) => photos.get(id),
    putPhoto: async (r) => { photos.set(r.id, r); },
    getKV: async (k) => (kv.has(k) ? c(kv.get(k)) : undefined),
    setKV: async (k, v) => { kv.set(k, c(v)); }
  };
}
const noTimers = { setTimeout: () => 0, clearTimeout: () => {} };
let clock = 1700000000000;
const tick = (ms) => { clock += ms || 1000; return clock; };

function job(name, extra) {
  const p = S.newProject({ client: name });
  p.name = name;
  return Object.assign(p, extra || {});
}
// device = its own store + engine + backend client on a shared server
function device(server, email, opts) {
  opts = opts || {};
  const be = B.createMock({ server });
  const store = memStore();
  const state = { open: null, enabled: true };
  const eng = Sync.createEngine(Object.assign({
    backend: be, store, now: () => clock, uid: (() => { let n = 0; return () => "copy-" + email + "-" + (++n); })(),
    enabled: () => state.enabled, isOpen: (id) => state.open === id, debounceMs: 0
  }, noTimers, opts.engine || {}));
  return { be, store, eng, state, email };
}
async function login(d) { await d.be.signInWithEmail(d.email); await d.be.verifyCode(d.email, "123456"); }

// owner "boss" on a crew plan + one invited member on a second device
async function crew(role) {
  const a = device(null, "boss@x.com");
  const server = a.be.server;
  const b = device(server, "crew@x.com");
  await login(a);
  server.setSubscription("boss@x.com", { plan: "crew", status: "active", seats: 3 });
  await login(b);
  const inv = await a.be.invite("crew@x.com", role || "member");
  await b.be.acceptInvite(inv.code);
  await a.eng.syncNow(); await b.eng.syncNow();     // first cycle: records the team + join time
  return { a, b, server };
}

// ---- core --------------------------------------------------------------------------

test("core: hash ignores updatedAt and key order, notices real edits", () => {
  const p = job("A");
  const q = JSON.parse(JSON.stringify(p));
  q.updatedAt = 5;
  assert.equal(Sync.hashProject(p), Sync.hashProject(q));
  const r = JSON.parse(JSON.stringify(p));
  r.rooms[0].name = "Kitchen";
  assert.notEqual(Sync.hashProject(p), Sync.hashProject(r));
  assert.equal(Sync.hashProject({ a: 1, b: 2 }), Sync.hashProject({ b: 2, a: 1 }));
});

test("core: conflict naming and copy", () => {
  const ms = new Date(2026, 9, 5, 12).getTime();
  assert.equal(Sync.conflictName("Smith", ms), "Smith (conflict 2026-10-05)");
  assert.equal(Sync.conflictName("Smith (conflict 2026-09-01)", ms), "Smith (conflict 2026-10-05)");
  assert.equal(Sync.conflictName("", ms), "Job (conflict 2026-10-05)");
  const p = job("Smith");
  p.updatedAt = 4;
  const c = Sync.makeConflictCopy(p, "new-id", ms);
  assert.equal(c.id, "new-id");
  assert.match(c.name, /\(conflict 2026-10-05\)$/);
  assert.match(c.client, /\(conflict 2026-10-05\)$/);
  assert.equal(c.updatedAt, undefined);
  assert.equal(p.id === c.id, false);
});

test("core: decide table", () => {
  const L = job("L"), R = JSON.parse(JSON.stringify(L));
  R.notes = "remote edit";
  const lh = Sync.hashProject(L);
  const rec = (project, rev, deleted) => ({ id: L.id, project, rev, deleted: !!deleted });
  assert.equal(Sync.decide(null, rec(R, "r1"), undefined).action, "adopt");
  assert.equal(Sync.decide(null, rec(R, "r1"), { rev: "r1", hash: "x" }).action, "skip");          // deleted locally
  assert.equal(Sync.decide(null, rec(R, "r2"), { rev: "r1", hash: "x" }).action, "adopt");         // teammate edited since
  assert.equal(Sync.decide(L, rec(L, "r1"), undefined).action, "same");
  assert.equal(Sync.decide(L, rec(R, "r2"), { rev: "r1", hash: lh }).action, "adopt");
  assert.equal(Sync.decide(L, rec(R, "r1"), { rev: "r1", hash: "old" }).action, "push");
  const edited = Object.assign(JSON.parse(JSON.stringify(L)), { notes: "local edit" });
  R.updatedAt = 200;
  assert.equal(Sync.decide(edited, rec(R, "r2"), { rev: "r1", hash: lh }, { localMs: 100 }).action, "conflict-remote-wins");
  R.updatedAt = 50;
  assert.equal(Sync.decide(edited, rec(R, "r2"), { rev: "r1", hash: lh }, { localMs: 100 }).action, "conflict-local-wins");
  assert.equal(Sync.decide(L, rec(R, "r2", true), { rev: "r1", hash: lh }).action, "orphan");
  assert.equal(Sync.decide(edited, rec(R, "r2", true), { rev: "r1", hash: lh }).action, "push-over");
});

test("core: tie in a true conflict resolves the same way on both devices", () => {
  const A = job("x"); const Bp = JSON.parse(JSON.stringify(A)); A.notes = "a"; Bp.notes = "b";
  A.updatedAt = Bp.updatedAt = 10;
  const ha = Sync.hashProject(A), hb = Sync.hashProject(Bp);
  const onA = Sync.decide(A, { id: A.id, project: Bp, rev: "r2" }, { rev: "r1", hash: "base" }, { localMs: 10 }).action;
  const onB = Sync.decide(Bp, { id: A.id, project: A, rev: "r3" }, { rev: "r1", hash: "base" }, { localMs: 10 }).action;
  // exactly one side keeps its own version
  assert.notEqual(onA, onB);
  assert.ok(ha !== hb);
});

test("core: queue dedupes and backoff grows then caps", () => {
  const q = [];
  Sync.core.enqueue(q, "a"); Sync.core.enqueue(q, "a"); Sync.core.enqueue(q, "b");
  assert.equal(q.length, 2);
  assert.ok(Sync.core.backoffMs(1) < Sync.core.backoffMs(3));
  assert.equal(Sync.core.backoffMs(30), 5 * 60000);
});

// ---- engine against the mock ---------------------------------------------------------

test("two devices: a job saved on A reaches B; B's edit comes back to A", async () => {
  const { a, b } = await crew("member");
  const p = job("Smith");
  await a.store.saveProject(p);
  await a.eng.localSaved(p);
  assert.equal(a.eng.status().pending, 1);
  await a.eng.syncNow();
  assert.equal(a.eng.status().state, "idle");
  assert.equal(a.eng.status().pending, 0);
  await b.eng.syncNow();
  const onB = await b.store.getProject(p.id);
  assert.equal(onB.client, "Smith");

  tick();
  onB.notes = "needs ladder";
  await b.store.saveProject(onB);
  await b.eng.localSaved(onB);
  await b.eng.syncNow();
  await a.eng.syncNow();
  assert.equal((await a.store.getProject(p.id)).notes, "needs ladder");
  assert.equal((await a.store.listProjects()).length, 1);
});

test("offline queue persists, status says offline, flushes when back", async () => {
  const { a, b } = await crew("member");
  const p = job("Offline job");
  await a.store.saveProject(p);
  a.be.setOnline(false);
  await a.eng.localSaved(p);
  await a.eng.syncNow();
  assert.equal(a.eng.status().state, "offline");
  assert.equal(a.eng.status().pending, 1);
  // restart: a new engine over the same store reloads the persisted queue
  const again = Sync.createEngine({ backend: a.be, store: a.store, now: () => clock, enabled: () => true, ...noTimers });
  await again.syncNow();
  assert.equal(again.status().state, "offline");
  assert.equal(again.status().pending, 1);
  a.be.setOnline(true);
  await again.syncNow();
  assert.equal(again.status().state, "idle");
  assert.equal(again.status().pending, 0);
  await b.eng.syncNow();
  assert.equal((await b.store.getProject(p.id)).client, "Offline job");
});

test("edit on two devices: newer wins, older is kept as a conflict copy (nothing dropped)", async () => {
  const { a, b } = await crew("member");
  const p = job("Jones");
  await a.store.saveProject(p); await a.eng.localSaved(p); await a.eng.syncNow();
  await b.eng.syncNow();

  // both edit the same job while apart
  tick(1000);
  const ea = await a.store.getProject(p.id); ea.notes = "A's measurements";
  await a.store.saveProject(ea); await a.eng.localSaved(ea);
  tick(5000);                                  // B edits LATER
  const eb = await b.store.getProject(p.id); eb.notes = "B's measurements";
  await b.store.saveProject(eb); await b.eng.localSaved(eb);

  await a.eng.syncNow();                       // A reaches the server first
  await b.eng.syncNow();                       // B pushes against a changed row → conflict path
  await a.eng.syncNow();
  await b.eng.syncNow();

  for (const d of [a, b]) {
    const all = await d.store.listProjects();
    assert.equal(all.length, 2, d.email + " should hold the job plus one conflict copy");
    const main = all.filter((x) => x.id === p.id)[0];
    const copy = all.filter((x) => x.id !== p.id)[0];
    assert.equal(main.notes, "B's measurements", "newer edit wins");
    assert.equal(copy.notes, "A's measurements", "older edit preserved");
    assert.match(copy.name, /Jones \(conflict \d{4}-\d{2}-\d{2}\)/);
  }
  assert.ok(b.eng.status().conflicts + a.eng.status().conflicts >= 1);
});

test("conflict copy duplicates photos under new ids", async () => {
  const { a, b } = await crew("member");
  const p = job("Photos");
  const w = S.addWindow(p.rooms[0]);
  w.photos.push("ph-1");
  await a.store.saveProject(p);
  await a.store.putPhoto({ id: "ph-1", projectId: p.id, windowId: w.id, blob: new Blob(["img"]), size: 3 });
  await a.eng.localSaved(p); await a.eng.syncNow();
  await b.eng.syncNow();
  assert.ok(b.store.photos.has("ph-1"), "photo synced lazily");

  tick(1000);
  const ea = await a.store.getProject(p.id); ea.notes = "A";
  await a.store.saveProject(ea); await a.eng.localSaved(ea);
  tick(5000);
  const eb = await b.store.getProject(p.id); eb.notes = "B";
  await b.store.saveProject(eb); await b.eng.localSaved(eb);
  await a.eng.syncNow(); await b.eng.syncNow();
  const all = await b.store.listProjects();
  const copy = all.filter((x) => x.id !== p.id)[0];
  const copyPhoto = copy.rooms[0].windows[0].photos[0];
  assert.notEqual(copyPhoto, "ph-1");
  assert.ok(b.store.photos.has(copyPhoto));
  assert.ok(b.store.photos.has("ph-1"));
});

test("viewer: pulls shared jobs, cannot push, local edits stay local and say read-only", async () => {
  const { a, b } = await crew("viewer");
  const p = job("Shared");
  await a.store.saveProject(p); await a.eng.localSaved(p); await a.eng.syncNow();
  await b.eng.syncNow();
  assert.equal((await b.store.getProject(p.id)).client, "Shared");
  assert.equal(b.eng.status().readOnly, true);

  const own = job("Viewer scribble");
  await b.store.saveProject(own);
  await b.eng.localSaved(own);
  await b.eng.syncNow();
  assert.equal(b.eng.status().pending, 0);
  assert.equal((await a.be.pullProjects("")).filter((r) => r.id === own.id).length, 0);
  assert.ok(!b.be.calls.some((c) => c === "pushProject"), "a viewer never even tries to push");
});

test("photos upload lazily and download on the other device", async () => {
  const { a, b } = await crew("member");
  const p = job("Pics");
  const w = S.addWindow(p.rooms[0]);
  w.photos.push("pa", "pb");
  await a.store.saveProject(p);
  await a.store.putPhoto({ id: "pa", projectId: p.id, windowId: w.id, blob: new Blob(["aaa"]), size: 3 });
  await a.store.putPhoto({ id: "pb", projectId: p.id, windowId: w.id, blob: new Blob(["bb"]), size: 2 });
  await a.eng.localSaved(p); await a.eng.syncNow();
  await b.eng.syncNow();
  const got = b.store.photos.get("pa");
  assert.equal(got.projectId, p.id);
  assert.equal(got.windowId, w.id);
  assert.equal(got.size, 3);
  assert.ok(b.store.photos.has("pb"));
});

test("remote change to a job being edited is deferred, then applied after leaving it", async () => {
  const { a, b } = await crew("member");
  const p = job("Open");
  await a.store.saveProject(p); await a.eng.localSaved(p); await a.eng.syncNow();
  await b.eng.syncNow();
  tick();
  const ea = await a.store.getProject(p.id); ea.notes = "from A";
  await a.store.saveProject(ea); await a.eng.localSaved(ea); await a.eng.syncNow();
  b.state.open = p.id;
  await b.eng.syncNow();
  assert.equal((await b.store.getProject(p.id)).notes, "", "open job untouched");
  b.state.open = null;
  await b.eng.syncNow();
  assert.equal((await b.store.getProject(p.id)).notes, "from A");
});

test("a job deleted on this device is not resurrected, unless a teammate edits it", async () => {
  const { a, b } = await crew("member");
  const p = job("Gone");
  await a.store.saveProject(p); await a.eng.localSaved(p); await a.eng.syncNow();
  await b.eng.syncNow();
  b.store.deleteLocal(p.id);
  await b.eng.syncNow();
  assert.equal(await b.store.getProject(p.id), null);
  tick();
  const ea = await a.store.getProject(p.id); ea.notes = "still working";
  await a.store.saveProject(ea); await a.eng.localSaved(ea); await a.eng.syncNow();
  await b.eng.syncNow();
  assert.equal((await b.store.getProject(p.id)).notes, "still working");
});

test("fullResync restores jobs removed from this device", async () => {
  const { a, b } = await crew("member");
  const p = job("Restore me");
  await a.store.saveProject(p); await a.eng.localSaved(p); await a.eng.syncNow();
  await b.eng.syncNow();
  b.store.deleteLocal(p.id);
  await b.eng.fullResync();
  assert.equal((await b.store.getProject(p.id)).client, "Restore me");
});

test("off when the plan has no team, or sync is disabled; never throws", async () => {
  const solo = device(null, "solo@x.com");
  await login(solo);
  solo.be.server.setSubscription("solo@x.com", { plan: "manual", status: "active", seats: 1 });
  const p = job("Local only");
  await solo.store.saveProject(p);
  await solo.eng.localSaved(p);
  await solo.eng.syncNow();
  assert.equal(solo.eng.status().state, "off");
  assert.equal(solo.be.calls.filter((c) => c === "pushProject").length, 0);

  solo.state.enabled = false;
  await solo.eng.syncNow();
  assert.equal(solo.eng.status().state, "off");
  await solo.eng.localSaved(null);                       // junk input is swallowed
});

test("signed out → error status, queue kept; server error → backoff, queue kept", async () => {
  const { a } = await crew("member");
  const p = job("Retry");
  await a.store.saveProject(p); await a.eng.localSaved(p);
  a.be.failNext("server");                               // fails the entitlement check
  await a.eng.syncNow();
  assert.equal(a.eng.status().state, "error");
  assert.equal(a.eng.status().pending, 1);
  await a.be.signOut();
  await a.eng.syncNow();
  assert.equal(a.eng.status().state, "error");
  assert.match(a.eng.status().error, /Sign in/);
  assert.equal(a.eng.status().pending, 1);
});

test("leaving team A and joining team B never auto-uploads A-era or never-synced jobs", async () => {
  const { a, b, server } = await crew("member");
  const old = job("Old client A"); old.createdAt = 1;            // created long before joining anything
  const mine = job("Synced under A"); mine.createdAt = clock + 10;   // created after joining A
  await b.store.saveProject(old); await b.store.saveProject(mine);
  await b.eng.localSaved(mine); await b.eng.syncNow();
  assert.equal((await a.be.pullProjects("")).filter((r) => r.id === mine.id).length, 1);
  assert.equal((await a.be.pullProjects("")).filter((r) => r.id === old.id).length, 0, "pre-join job stays private");
  assert.deepEqual(await b.eng.unsharedJobs(), [old.id]);

  // b leaves A, then joins a different team B (owner "other")
  const crewMember = (await a.be.listMembers()).filter((m) => m.email === "crew@x.com")[0];
  await a.be.removeMember(crewMember.userId);
  const o = device(server, "other@x.com"); await login(o);
  server.setSubscription("other@x.com", { plan: "crew", status: "active", seats: 3 });
  const inv = await o.be.invite("crew@x.com", "member");
  await b.be.acceptInvite(inv.code);
  tick(60000);
  await b.eng.syncNow();
  assert.equal(b.eng.status().state, "idle");
  const inB = (await o.be.pullProjects("")).map((r) => r.id);
  assert.ok(!inB.includes(old.id) && !inB.includes(mine.id), "nothing from team A uploaded to team B");
  assert.equal((await b.store.getProject(mine.id)).client, "Synced under A", "still on the phone");

  // a job created after joining B does sync
  tick(1000);
  const fresh = job("New under B"); fresh.createdAt = clock + 1000;
  await b.store.saveProject(fresh); await b.eng.localSaved(fresh); await b.eng.syncNow();
  assert.ok((await o.be.pullProjects("")).some((r) => r.id === fresh.id));

  // explicit opt-in shares the old ones
  const n = await b.eng.shareJobs([old.id]);
  assert.equal(n, 1);
  const inB2 = (await o.be.pullProjects("")).map((r) => r.id);
  assert.ok(inB2.includes(old.id) && !inB2.includes(mine.id));
});

test("a plan bought later does not auto-share the jobs already on the phone", async () => {
  const solo = device(null, "later@x.com");
  await login(solo);
  const p = job("Existing"); p.createdAt = 5;
  await solo.store.saveProject(p);
  solo.be.server.setSubscription("later@x.com", { plan: "crew", status: "active", seats: 2 });
  await solo.eng.localSaved(p);
  await solo.eng.syncNow();
  assert.equal((await solo.be.pullProjects("")).length, 0);
  assert.equal((await solo.eng.unsharedJobs()).length, 1);
  assert.equal(await solo.eng.shareJobs(), 1);
  assert.equal((await solo.be.pullProjects("")).length, 1);
});

test("pull re-reads a 30 s overlap behind the cursor and ignores records it already has", async () => {
  const { a, b } = await crew("member");
  const p = job("Overlap"); await a.store.saveProject(p); await a.eng.localSaved(p); await a.eng.syncNow();
  const seen = [];
  const orig = b.be.pullProjects;
  b.be.pullProjects = (since) => { seen.push(since); return orig(since); };
  await b.eng.syncNow();                      // gets the job, cursor = its rev
  const cursor = b.eng._state().since;
  await b.eng.syncNow();
  const used = seen[seen.length - 1];
  assert.equal(Date.parse(cursor) - Date.parse(used), 30000);
  assert.equal((await b.store.listProjects()).length, 1, "overlap re-delivery creates no duplicates");
  assert.equal(b.eng.status().conflicts, 0);
});

test("past_due stops team sync 7 days after the period end", async () => {
  const { a, server } = await crew("member");
  const sub = server.subs[Object.keys(server.subs)[0]];
  sub.status = "past_due"; sub.currentPeriodEnd = new Date(clock - 2 * 86400000).toISOString();   // engine clock
  await a.eng.syncNow();
  assert.equal(a.eng.status().state, "idle");
  sub.currentPeriodEnd = new Date(clock - 9 * 86400000).toISOString();
  await a.eng.syncNow();
  assert.equal(a.eng.status().state, "off");
});
