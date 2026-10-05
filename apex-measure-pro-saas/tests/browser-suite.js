/* Browser test suite — open tests/browser.html (from disk or a server). */
(function () {
  "use strict";
  var B = window.ApexBle, S = window.ApexStore, R = window.ApexReduce;
  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg || "") + " expected " + JSON.stringify(b) + " got " + JSON.stringify(a)); }
  function flush() { return new Promise(function (r) { setTimeout(r, 0); }); }
  async function settle() { for (var i = 0; i < 10; i++) await flush(); }

  // --- fakes -----------------------------------------------------------------

  function fakeTimers() {
    var queue = [], id = 0;
    return {
      setTimeout: function (fn, ms) { id++; queue.push({ id: id, fn: fn, ms: ms }); return id; },
      clearTimeout: function (t) { queue = queue.filter(function (q) { return q.id !== t; }); },
      pending: function () { return queue.map(function (q) { return q.ms; }); },
      runNext: async function () { var q = queue.shift(); if (q) q.fn(); await settle(); return q && q.ms; }
    };
  }

  function fakeDoc() {
    var d = new EventTarget();
    d.hidden = false;
    d.setHidden = function (v) { d.hidden = v; d.dispatchEvent(new Event("visibilitychange")); };
    return d;
  }

  function floatView(meters) {
    var b = new ArrayBuffer(4);
    new DataView(b).setFloat32(0, meters, true);
    return new DataView(b);
  }

  // A DISTO whose characteristic objects die on disconnect, exactly like real GATT.
  function fakeDisto(opts) {
    opts = opts || {};
    var dev = new EventTarget();
    dev.name = "DISTO fake";
    dev.connectFails = 0;
    dev.connects = 0;
    dev.subscribes = 0;
    dev.notifyGate = null;       // a promise startNotifications waits on, if set
    var live = null;
    function makeChar(uuid, props) {
      var c = new EventTarget();
      c.uuid = uuid;
      c.properties = props;
      c.alive = true;
      c.notifying = false;
      c.startNotifications = async function () {
        if (dev.notifyGate) await dev.notifyGate;
        c.notifying = true;
        dev.subscribes++;
        return c;
      };
      c.writeValue = async function () {};
      return c;
    }
    function makeService() {
      var meas = makeChar(B.MEASUREMENT_UUID, { notify: true });
      var units = makeChar(B.UNITS_UUID, { read: true });
      var chars = [meas, units];
      if (opts.writable !== false) chars.push(makeChar("3ab10103-0000-0000-0000-000000000000", { write: true }));
      live = meas;
      return {
        getCharacteristic: async function (u) { return chars.filter(function (c) { return c.uuid === u; })[0]; },
        getCharacteristics: async function () { return chars.slice(); }
      };
    }
    var server = { getPrimaryService: async function (u) { eq(u, B.SERVICE_UUID, "service uuid"); return makeService(); } };
    dev.gatt = {
      connected: false,
      connect: async function () {
        if (dev.connectFails > 0) { dev.connectFails--; throw new Error("unreachable"); }
        dev.gatt.connected = true;
        dev.connects++;
        return server;
      },
      disconnect: function () { dev.drop(); }
    };
    dev.drop = function () {                   // link lost: every subscription and reference dies
      dev.gatt.connected = false;
      if (live) { live.alive = false; live.notifying = false; }
      dev.dispatchEvent(new Event("gattserverdisconnected"));
    };
    dev.emit = function (meters) {             // the laser fires a measurement
      if (!live || !live.alive || !live.notifying) return false;
      live.value = floatView(meters);
      live.dispatchEvent(new Event("characteristicvaluechanged"));
      return true;
    };
    return dev;
  }

  function fakeChannelBus() {
    var members = [];
    function Channel() { this.onmessage = null; members.push(this); }
    Channel.prototype.postMessage = function (data) {
      var self = this;
      members.forEach(function (m) { if (m !== self && m.onmessage) setTimeout(function () { m.onmessage({ data: data }); }, 0); });
    };
    return Channel;
  }

  function laser(dev, extra) {
    var timers = fakeTimers(), doc = fakeDoc(), readings = [], states = [];
    var l = B.createLaser(Object.assign({
      bluetooth: { requestDevice: async function () { return dev; } },
      doc: doc, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
      BroadcastChannel: null, channelWaitMs: 0,
      onReading: function (m) { readings.push(m); },
      onState: function (s) { states.push(s.status); }
    }, extra || {}));
    return { l: l, timers: timers, doc: doc, readings: readings, states: states };
  }

  // --- BLE ----------------------------------------------------------------------

  test("§3.2 disconnect → reconnect re-discovers, re-subscribes, readings resume", async function () {
    var dev = fakeDisto(), t = laser(dev);
    assert(await t.l.connect(), "connect");
    eq(t.l.snapshot().status, "connected");
    assert(dev.emit(0.9017), "first reading delivered");
    eq(R.describeMeters(t.readings[0]).text, '35 1/2"');

    dev.drop();
    eq(t.l.snapshot().status, "reconnecting");
    assert(!dev.emit(0.5), "old subscription is dead");
    eq(t.timers.pending()[0], 1000, "first backoff 1s");
    await t.timers.runNext();

    eq(t.l.snapshot().status, "connected");
    eq(dev.connects, 2);
    eq(dev.subscribes, 2, "re-subscribed");
    assert(dev.emit(0.9144), "reading after reconnect delivered");
    eq(t.readings.length, 2);
    eq(R.describeMeters(t.readings[1]).text, '36"');
  });

  test("§3.2 'connected' only after startNotifications resolves", async function () {
    var dev = fakeDisto(), t = laser(dev);
    var release;
    dev.notifyGate = new Promise(function (r) { release = r; });
    var p = t.l.connect();
    await settle();
    assert(t.l.snapshot().status !== "connected", "not connected while subscribing (" + t.l.snapshot().status + ")");
    release();
    await p;
    eq(t.l.snapshot().status, "connected");
  });

  test("§3.2 backoff 1,2,5,15,30 then every 60s, never gives up", async function () {
    var dev = fakeDisto(), t = laser(dev);
    await t.l.connect();
    dev.connectFails = 1000;
    dev.drop();
    var seen = [];
    for (var i = 0; i < 9; i++) seen.push(await t.timers.runNext());
    eq(JSON.stringify(seen), JSON.stringify([1000, 2000, 5000, 15000, 30000, 60000, 60000, 60000, 60000]));
    eq(t.l.snapshot().message, B.MSG_UNREACHABLE);
    eq(t.timers.pending().length, 1, "still scheduled");
  });

  test("§3.2 pauses while hidden, resumes on visible", async function () {
    var dev = fakeDisto(), t = laser(dev);
    await t.l.connect();
    dev.connectFails = 1;
    t.doc.setHidden(true);
    dev.drop();
    eq(t.timers.pending().length, 0, "no timer while hidden");
    t.doc.setHidden(false);
    await settle();                     // visible → immediate attempt (fails once)
    eq(t.timers.pending()[0], 2000, "backoff continues");
    await t.timers.runNext();
    eq(t.l.snapshot().status, "connected");
  });

  test("§3.2 manual Reconnect cancels the timer, tries now; failure restarts at 1s", async function () {
    var dev = fakeDisto(), t = laser(dev);
    await t.l.connect();
    dev.connectFails = 4;
    dev.drop();
    await t.timers.runNext(); await t.timers.runNext(); await t.timers.runNext();   // now at 15s step
    eq(t.timers.pending()[0], 15000);
    await t.l.reconnectNow();             // fails
    eq(JSON.stringify(t.timers.pending()), "[1000]", "restarted from 1s, old timer cancelled");
    await t.timers.runNext();
    eq(t.l.snapshot().status, "connected");
  });

  test("§3.3 writable characteristic found by discovery; trigger gated while TRIGGER_COMMAND is null", async function () {
    eq(B.TRIGGER_COMMAND, null, "gate intact");
    var dev = fakeDisto(), t = laser(dev);
    await t.l.connect();
    eq(t.l.snapshot().canTrigger, false);
    eq(await t.l.trigger(), false);
    eq(B.canTrigger({ writableChar: {} }), false);
  });

  test("explicit disconnect does not auto-reconnect", async function () {
    var dev = fakeDisto(), t = laser(dev);
    await t.l.connect();
    t.l.disconnect();
    eq(t.l.snapshot().status, "idle");
    eq(t.timers.pending().length, 0);
  });

  test("§8.7 second tab is told another tab holds the laser", async function () {
    var Bus = fakeChannelBus();
    var a = laser(fakeDisto(), { BroadcastChannel: Bus, channelWaitMs: 5, setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window) });
    await a.l.connect();
    eq(a.l.snapshot().status, "connected");
    var requested = false;
    var b = B.createLaser({ bluetooth: { requestDevice: async function () { requested = true; return fakeDisto(); } },
      doc: fakeDoc(), BroadcastChannel: Bus, channelWaitMs: 20 });
    await b.connect();
    eq(b.snapshot().status, "busy-elsewhere");
    eq(b.snapshot().message, B.MSG_OTHER_TAB);
    assert(!requested, "did not attempt a connect that would fail");
  });

  test("§8.7 fallback without BroadcastChannel: failed connect says both", async function () {
    var dev = fakeDisto(); dev.connectFails = 1;
    var t = laser(dev);
    await t.l.connect();
    assert(t.l.snapshot().message.indexOf(B.MSG_OTHER_TAB) !== -1, t.l.snapshot().message);
  });

  test("no navigator.bluetooth → unsupported (manual-entry mode)", async function () {
    var l = B.createLaser({ bluetooth: null, doc: fakeDoc(), BroadcastChannel: null });
    eq(l.snapshot().status, "unsupported");
    eq(await l.connect(), false);
  });

  // --- IndexedDB --------------------------------------------------------------

  test("IndexedDB: save, list, corrupted row preserved, delete removes photos", async function () {
    var name = "apex-test-" + Date.now();
    var r = await S.open({ name: name });
    eq(r.persistent, true, "IndexedDB available");
    var p = S.newProject({ client: "Smith", date: "2026-09-28" });
    var w = S.addWindow(p.rooms[0]);
    w.width.shots.push(R.makeShot(35.51, "laser")); S.recomputeOrdered(w.width);
    await S.putPhoto({ id: "ph1", projectId: p.id, windowId: w.id, blob: new Blob(["x"]), size: 1 });
    w.photos.push("ph1");
    await S.saveProject(p);
    var bad = { id: "broken", schemaVersion: 1, date: "2026-01-01", rooms: 42 };
    await S.saveProject(bad);
    var rows = await S.listProjects();
    eq(rows.length, 2);
    var good = rows.filter(function (x) { return x.ok; })[0];
    eq(good.project.rooms[0].windows[0].width.ordered, 35.5);
    var broken = rows.filter(function (x) { return !x.ok; })[0];
    eq(broken.raw.rooms, 42, "raw preserved");
    assert(await S.getPhoto("ph1"), "photo stored");
    await S.deleteProject(p.id);
    eq(await S.getPhoto("ph1"), undefined, "photo deleted with project");
    eq((await S.listProjects()).length, 1, "corrupted row never auto-deleted");
    indexedDB.deleteDatabase(name);
  });

  test("§14.1 memory-only mode when IndexedDB is unavailable", async function () {
    var r = await S.open({ indexedDB: null });
    eq(r.persistent, false);
    var p = S.newProject({});
    await S.saveProject(p);
    eq((await S.listProjects()).length, 1);
    await S.setKV("k", { a: 1 });
    eq((await S.getKV("k")).a, 1);
  });

  test("§14.1 memory-only mode when indexedDB.open throws", async function () {
    var r = await S.open({ indexedDB: { open: function () { throw new Error("SecurityError"); } } });
    eq(r.persistent, false);
  });

  // --- run ------------------------------------------------------------------------

  (async function run() {
    var ol = document.getElementById("results"), pass = 0, fail = 0, failures = [];
    for (var i = 0; i < tests.length; i++) {
      var li = document.createElement("li");
      try { await tests[i].fn(); pass++; li.className = "pass"; li.textContent = "✓ " + tests[i].name; }
      catch (e) { fail++; li.className = "fail"; li.textContent = "✗ " + tests[i].name + " — " + e.message; failures.push(tests[i].name + ": " + e.message); }
      ol.appendChild(li);
    }
    document.getElementById("summary").textContent = pass + " passed, " + fail + " failed";
    window.__results = { pass: pass, fail: fail, failures: failures };
  })();
})();
