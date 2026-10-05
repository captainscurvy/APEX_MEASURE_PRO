/*
 * ext.js — the extension registry. main.js is the only module that renders the core app;
 * every SaaS module (account, voice, team, orders, …) plugs in HERE instead of editing
 * main.js. Modules register in their own file; main.js calls the hooks.
 *
 *   ApexExt.routes[name] = function (route, ctx) { ... }     render a screen via ctx.mount()
 *   ApexExt.routeParsers.push(function (parts) -> route|null) map #/a/b/c → { name, ... }
 *   ApexExt.beforeRoute.push(function (route, ctx) -> true | false | Promise<boolean>)
 *                                                              return false = "I rendered a gate; stop"
 *   ApexExt.captureTools.push(function (ctx) -> Node|null)    extra controls on the capture screen
 *   ApexExt.homeBlocks.push(function (ctx) -> Node|null)      blocks on the home screen
 *   ApexExt.settingsBlocks.push(function (ctx) -> Node|null)  blocks on the settings screen
 *   ApexExt.onBoot.push(function (ctx))                       after storage is open, before first route
 *   ApexExt.onProjectSaved.push(function (project))           after every local save (sync hook)
 *
 * ctx (set by main.js) = { h, mount, setBar, snack, go, announce, confirmDialog, S, R, C,
 *   app, dispatch, laser(), saveProject(), iconBtn }
 */
(function (root) {
  "use strict";
  var ext = root.ApexExt = root.ApexExt || {};
  ["routeParsers", "beforeRoute", "captureTools", "homeBlocks", "settingsBlocks", "onBoot", "onProjectSaved"]
    .forEach(function (k) { ext[k] = ext[k] || []; });
  ext.routes = ext.routes || {};
  ext.ctx = ext.ctx || null;

  // Safe call helpers used by main.js: a broken module must never take the core app down.
  ext.collect = function (list, arg) {
    var out = [];
    list.forEach(function (fn) {
      try { var n = fn(arg); if (n) out.push(n); } catch (e) { if (root.console) console.error("[ApexExt]", e); }
    });
    return out;
  };
  ext.fire = function (list, arg) {
    list.forEach(function (fn) {
      try { fn(arg); } catch (e) { if (root.console) console.error("[ApexExt]", e); }
    });
  };
  ext.parseRoute = function (parts) {
    for (var i = 0; i < ext.routeParsers.length; i++) {
      var r = null;
      try { r = ext.routeParsers[i](parts); } catch (e) { r = null; }
      if (r && r.name) return r;
    }
    return null;
  };
  // Run gates in order; resolves false as soon as one blocks.
  ext.runGates = function (route, ctx) {
    var chain = Promise.resolve(true);
    ext.beforeRoute.forEach(function (g) {
      chain = chain.then(function (ok) {
        if (!ok) return false;
        try { return Promise.resolve(g(route, ctx)).then(function (v) { return v !== false; }); }
        catch (e) { return true; }
      });
    });
    return chain;
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
