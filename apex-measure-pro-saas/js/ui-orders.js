/*
 * ui-orders.js — #/orders: "Order-ready output — under construction". No supplier-specific code.
 * Gated on ApexConfig.orderReadyEnabled (false). When it is flipped to true this screen should be replaced
 * by the real feature; until then it only explains and collects requests by email.
 */
(function () {
  "use strict";
  var X = window.ApexExt, CFG = window.ApexConfig || {};
  if (!X) return;
  var EMAIL = (CFG.company && CFG.company.supportEmail) || "apexinstallationsok@gmail.com";

  X.routeParsers.push(function (parts) { return parts[0] === "orders" ? { name: "orders" } : null; });

  X.routes.orders = function (r, ctx) {
    var h = ctx.h;
    ctx.setBar({ title: "Order-ready output", back: "#/settings" });
    var mail = "mailto:" + EMAIL + "?subject=" + encodeURIComponent("Order-ready output request") +
      "&body=" + encodeURIComponent("Supplier / system I order from:\nFile format or portal I need:\nHow I order today:\n");
    var body = CFG.orderReadyEnabled
      ? h("p", { text: "Order-ready output is enabled but its screen has not been installed in this build." })
      : h("p", null, "Supplier-ready order files are coming. Your measurement sheets and exports work exactly as before, and nothing here changes your jobs.");
    ctx.mount(h("div", { class: "stack orders" },
      h("div", { class: "banner", role: "note" }, h("div", null, h("strong", { text: "Order-ready output — under construction" }))),
      body,
      h("p", { class: "muted", text: "The goal: send a finished set of measurements to your supplier in the format they expect, without retyping. We are still talking with suppliers and nothing is promised yet." }),
      h("p", { text: "Tell us which suppliers and file formats or ordering portals you use, and we will prioritize the ones installers ask for most." }),
      h("a", { class: "btn btn-primary btn-block", href: mail, text: "Email a supplier or format request" }),
      h("p", { class: "small muted", text: "Always verify every measurement yourself before ordering or cutting." })));
  };

  function block(ctx) {
    var h = ctx.h;
    return h("div", { class: "section form-grid orders" },
      h("div", { class: "section-head" }, h("span", { class: "label", text: "Order-ready output" })),
      h("p", { class: "muted small", text: "Supplier-ready order files: under construction." }),
      h("button", { class: "btn btn-block", type: "button", text: "Learn more / request a supplier", onclick: function () { ctx.go("#/orders"); } }));
  }
  X.settingsBlocks.push(block);
  X.homeBlocks.push(function (ctx) {
    var h = ctx.h;
    return h("div", { class: "orders-home" },
      h("a", { class: "small muted", href: "#/orders", text: "Order-ready output: coming soon" }));
  });
})();
