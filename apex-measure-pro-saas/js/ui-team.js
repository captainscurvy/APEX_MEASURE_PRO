/*
 * ui-team.js — route #/team (members, invites, sync status) + settings/home entries.
 * Plugs in ONLY through ApexExt. In demo mode (no backend configured) it shows a calm
 * "needs the cloud server" state instead of errors. Every dependency (ApexBackend, ApexPlans,
 * ApexSync, ApexAccount) is optional and guarded — those modules may be placeholders.
 */
(function (root) {
  "use strict";
  var X = root.ApexExt;
  if (!X) return;

  var ROLE_LABEL = { owner: "Owner", admin: "Admin", member: "Member", viewer: "Viewer (free)" };
  var ROLE_HELP = {
    owner: "Runs the account and billing.",
    admin: "Can invite, remove and change roles. Edits jobs.",
    member: "Measures and edits shared jobs.",
    viewer: "Reads shared jobs only. Free — for office staff."
  };

  function B() { return root.ApexBackend || null; }
  function cfg() { return root.ApexConfig || { demo: true }; }
  function isDemo() { var b = B(); return !b || !b.configured || !b.configured(); }
  function planHasTeam() {
    try { return Boolean(root.ApexPlans && root.ApexPlans.has && root.ApexPlans.has("team")); } catch (e) { return false; }
  }
  function syncStatus() {
    try { return root.ApexSync && root.ApexSync.status ? root.ApexSync.status() : { state: "off", pending: 0 }; }
    catch (e) { return { state: "off", pending: 0 }; }
  }
  function session() { try { return B() && B().session ? B().session() : null; } catch (e) { return null; } }

  function ago(ms) {
    if (!ms) return "";
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 45) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    return Math.round(s / 86400) + " d ago";
  }
  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }

  function statusText(st, ent) {
    if (ent && ent.role === "viewer") {
      return "View-only. You can read the crew's jobs here; changes you make stay on this phone." +
        (st.lastSyncedAt ? " Updated " + ago(st.lastSyncedAt) + "." : "");
    }
    var waiting = st.pending ? " " + plural(st.pending, "item") + " waiting." : "";
    switch (st.state) {
      case "syncing": return "Syncing…" + waiting;
      case "idle": return (st.lastSyncedAt ? "Up to date — synced " + ago(st.lastSyncedAt) + "." : "Ready.") + waiting;
      case "offline": return "Offline. Your work is saved on this phone and will sync when you have signal." + waiting;
      case "error": return (st.error || "Sync hit a problem.") + " Your work is safe on this phone." + waiting;
      default: return "Sync is off.";
    }
  }

  function friendly(e) {
    var d = e && e.detail, c = e && e.code;
    if (c === "offline") return "You're offline. Try again when you have signal.";
    if (c === "unauthorized") return "Please sign in again.";
    if (c === "not-configured") return "Team sharing needs the cloud server, which isn't set up yet.";
    if (d === "seat-limit") return "All paid seats are in use. Add seats in billing, or invite as a free viewer.";
    if (d === "plan-required") return "The Crew plan is needed to add people.";
    if (d === "email-mismatch") return "That invite was sent to a different email. Sign in with the invited address.";
    if (d === "invalid-invite") return "That code is invalid or has expired. Ask for a new one.";
    if (d === "cancel-plan-first") return "Cancel your own subscription first (Settings → Account → Manage subscription), then join.";
    if (d === "transfer-ownership-first") return "You own a team that still has people on it. Remove them or hand over ownership before joining another team.";
    if (d === "owner-only") return "Only the owner can do that.";
    if (d === "owner") return "The owner can't be changed or removed.";
    if (d === "bad-email") return "Enter a valid email address.";
    if (c === "forbidden") return "You don't have permission to do that.";
    return (e && e.message) || "Something went wrong. Try again.";
  }

  // ---- entry points -----------------------------------------------------------------------

  X.routeParsers.push(function (parts) { return parts[0] === "team" ? { name: "team" } : null; });

  X.settingsBlocks.push(function (ctx) {
    var demo = isDemo();
    if (!demo && !planHasTeam()) return null;
    var h = ctx.h;
    var st = syncStatus();
    return h("div", { class: "section form-grid team-entry" },
      h("div", { class: "section-head" }, h("span", { class: "label", text: "Team" })),
      h("p", { class: "small muted", text: demo
        ? "Share jobs with your crew. Needs the cloud server — not configured yet."
        : (st.state === "off" ? "Share jobs with your crew and office." : statusText(st, null)) }),
      h("button", { class: "btn", type: "button", text: "Open Team", onclick: function () { ctx.go("#/team"); } }));
  });

  X.homeBlocks.push(function (ctx) {
    if (isDemo() || !planHasTeam()) return null;
    var st = syncStatus();
    if (st.state === "off") return null;
    var h = ctx.h;
    var bad = st.state === "error";
    return h("button", { class: "team-chip" + (bad ? " team-chip-bad" : ""), type: "button",
      "aria-label": "Team sync: " + statusText(st, null), onclick: function () { ctx.go("#/team"); } },
      h("span", { class: "team-dot team-dot-" + st.state, "aria-hidden": "true" }),
      h("span", { text: "Team · " + statusText(st, null).replace(/\s+Your work is safe on this phone\./, "") }));
  });

  // ---- the screen -------------------------------------------------------------------------

  X.routes.team = function (route, ctx) {
    var h = ctx.h;
    ctx.setBar({ title: "Team", back: "#/settings" });
    var box = h("div", { class: "stack team" });
    ctx.mount(box);

    function put() {
      box.innerHTML = "";
      for (var i = 0; i < arguments.length; i++) if (arguments[i]) box.appendChild(arguments[i]);
    }
    function card(title, children) {
      return h("div", { class: "section" },
        h("div", { class: "section-head" }, h("span", { class: "label", text: title })),
        children);
    }
    function explainer() {
      return card("How sharing works", h("div", { class: "team-explain" },
        h("p", { class: "small", text: "Shared jobs: on the Crew plan every job on your phone also syncs to your crew, so two people can measure different rooms of the same house." }),
        h("p", { class: "small", text: "Your phone stays the master copy. Everything works with no signal and catches up later." }),
        h("p", { class: "small", text: "If two people change the same job while offline, the newer change is kept and the other is saved as a copy named “… (conflict date)”. Nothing is thrown away." }),
        h("p", { class: "small", text: "Office staff can be added as free Viewers — they read jobs and sheets but can't change them. Only Members and Admins use a paid seat." })));
    }

    if (isDemo()) {
      put(h("div", { class: "team-calm" },
        h("p", { class: "lede", text: "Team sharing needs the cloud server — not configured yet." }),
        h("p", { class: "muted", text: "Nothing is wrong. Apex Measure Pro works fully on this phone today; shared jobs switch on once the account server is connected." })),
        explainer());
      return Promise.resolve();
    }
    if (!session()) {
      put(h("div", { class: "team-calm" },
        h("p", { class: "lede", text: "Sign in to share jobs with your crew." }),
        h("button", { class: "btn btn-primary", type: "button", text: "Sign in", onclick: function () { ctx.go("#/account"); } })),
        explainer());
      return Promise.resolve();
    }

    put(h("p", { class: "muted", text: "Loading team…" }));
    var unsub = null, lastInvite = null;

    function load() {
      var b = B();
      return b.getEntitlement().then(function (ent) {
        if (ent.plan !== "crew" || !ent.orgId) {
          put(h("div", { class: "team-calm" },
            h("p", { class: "lede", text: "Team sharing is part of the Crew plan." }),
            h("p", { class: "muted", text: "Have an invite code from your boss? Enter it below." }),
            h("button", { class: "btn", type: "button", text: "See plans", onclick: function () { ctx.go("#/plans"); } })),
            joinCard(), explainer());
          return;
        }
        var admin = ent.role === "owner" || ent.role === "admin";
        return Promise.all([
          b.listMembers(),
          admin && b.listInvites ? b.listInvites().catch(function () { return []; }) : Promise.resolve([]),
          root.ApexSync && root.ApexSync.unsharedJobs ? root.ApexSync.unsharedJobs().catch(function () { return []; }) : Promise.resolve([])
        ]).then(function (res) { draw(ent, res[0], res[1], admin, res[2]); });
      }).catch(function (e) {
        put(h("div", { class: "team-calm" },
          h("p", { class: "advisory", role: "status", text: friendly(e) }),
          h("button", { class: "btn", type: "button", text: "Try again", onclick: function () { load(); } })));
      });
    }

    function act(promise, okMsg) {
      return promise.then(function (r) { if (okMsg) ctx.snack(okMsg); return r; },
        function (e) { ctx.snack(friendly(e), { bad: true }); throw e; });
    }

    function joinCard() {
      var code = h("input", { class: "input", type: "text", id: "team-code", autocomplete: "off", autocapitalize: "characters",
        spellcheck: "false", placeholder: "XXXX-XXXX-XXXX" });
      return card("Join a team", h("div", { class: "form-grid" },
        h("label", { class: "field", for: "team-code" }, h("span", { class: "label", text: "Invite code" }), code),
        h("p", { class: "small muted", text: "Sign in with the email address the invite was sent to. Joining moves you onto that team." }),
        h("button", { class: "btn btn-primary", type: "button", text: "Join team", onclick: function () {
          var v = code.value.trim();
          if (!v) { ctx.snack("Enter the invite code.", { bad: true }); return; }
          act(B().acceptInvite(v), "Joined the team.").then(function () {
            try { if (root.ApexAccount && root.ApexAccount.refresh) root.ApexAccount.refresh(); } catch (e) { /* optional */ }
            try { if (root.ApexSync && root.ApexSync.syncNow) root.ApexSync.syncNow(); } catch (e) { /* optional */ }
            load();
          }, function () {});
        } })));
    }

    function draw(ent, members, invites, admin, unshared) {
      var me = session() || {};
      var paid = members.filter(function (m) { return m.role !== "viewer"; }).length + invites.filter(function (i) { return i.role !== "viewer"; }).length;
      var statusLine = h("p", { class: "team-status", role: "status", "aria-live": "polite", text: statusText(syncStatus(), ent) });
      var st0 = syncStatus();
      var conflictNote = st0.conflicts ? h("p", { class: "advisory", text: plural(st0.conflicts, "job") +
        " were edited in two places. Look for jobs named “… (conflict date)” — keep what you need and delete the rest." }) : null;
      var unreadable = st0.unreadable ? h("p", { class: "advisory", text: plural(st0.unreadable, "shared job") +
        " came from a newer version of the app and can't be opened here yet. Update the app." }) : null;

      if (unsub) unsub();
      unsub = null;
      try {
        if (root.ApexSync && root.ApexSync.onChange) {
          unsub = root.ApexSync.onChange(function () {
            if (!statusLine.isConnected) { if (unsub) unsub(); return; }
            statusLine.textContent = statusText(syncStatus(), ent);
          });
        }
      } catch (e) { /* optional */ }

      var syncCard = card("Sync", h("div", { class: "form-grid" }, statusLine, conflictNote, unreadable,
        h("div", { class: "row-actions" },
          h("button", { class: "btn", type: "button", text: "Sync now", onclick: function () {
            try { root.ApexSync.syncNow(); ctx.announce("Syncing"); } catch (e) { ctx.snack("Sync isn't available right now.", { bad: true }); }
          } }),
          h("button", { class: "btn", type: "button", text: "Re-download shared jobs", onclick: function () {
            ctx.confirmDialog("Download every shared job again? Jobs you deleted on this phone come back. Nothing is overwritten.", "Download").then(function (ok) {
              if (ok) { try { root.ApexSync.fullResync(); ctx.snack("Downloading shared jobs…"); } catch (e) { /* optional */ } }
            });
          } }))));

      // Existing jobs never upload on their own (they may belong to another client or company). Opt-in only.
      var shareCard = null;
      if (unshared.length && ent.role !== "viewer") {
        shareCard = card("Jobs from before you joined", h("div", { class: "form-grid" },
          h("p", { class: "small", text: plural(unshared.length, "job") + " on this phone " + (unshared.length === 1 ? "is" : "are") +
            " not shared with the team. New jobs you create share automatically; older ones stay private unless you choose." }),
          h("button", { class: "btn", type: "button", text: "Share my existing jobs with this team", onclick: function () {
            ctx.confirmDialog("Share " + plural(unshared.length, "existing job") + " (with photos) with everyone on this team? Members will see client names and addresses.", "Share").then(function (ok) {
              if (!ok) return;
              act(root.ApexSync.shareJobs(), "Sharing started.").then(load, function () {});
            });
          } })));
      }

      // members
      var list = h("ul", { class: "list", "aria-label": "Team members" });
      members.forEach(function (m) {
        var mine = m.userId === me.userId;
        var canManage = admin && m.role !== "owner" && !mine && !(ent.role === "admin" && m.role === "admin");
        var right = h("div", { class: "team-actions" });
        if (canManage) {
          var sel = h("select", { class: "select team-role", "aria-label": "Role for " + m.email });
          ["admin", "member", "viewer"].forEach(function (r) {
            if (r === "admin" && ent.role !== "owner") return;
            sel.appendChild(h("option", { value: r, text: ROLE_LABEL[r], selected: m.role === r ? true : null }));
          });
          sel.addEventListener("change", function () {
            act(B().setRole(m.userId, sel.value), "Role updated.").then(load, function () { sel.value = m.role; });
          });
          right.appendChild(sel);
          right.appendChild(h("button", { class: "btn btn-ghost", type: "button", text: "Remove", "aria-label": "Remove " + m.email, onclick: function () {
            ctx.confirmDialog("Remove " + m.email + " from the team? Jobs on their phone stay with them; the company's copies stay here.", "Remove").then(function (ok) {
              if (ok) act(B().removeMember(m.userId), "Removed.").then(load, function () {});
            });
          } }));
        } else if (mine && m.role !== "owner") {
          right.appendChild(h("button", { class: "btn btn-ghost", type: "button", text: "Leave team", onclick: function () {
            ctx.confirmDialog("Leave this team? Jobs already on your phone stay on your phone.", "Leave").then(function (ok) {
              if (ok) act(B().removeMember(m.userId), "You left the team.").then(function () {
                try { if (root.ApexAccount && root.ApexAccount.refresh) root.ApexAccount.refresh(); } catch (e) { /* optional */ }
                load();
              }, function () {});
            });
          } }));
        } else {
          right.appendChild(h("span", { class: "team-role-badge", text: ROLE_LABEL[m.role] || m.role }));
        }
        list.appendChild(h("li", { class: "list-row" },
          h("div", { class: "row-main team-member" },
            h("span", { class: "row-title", text: m.email + (mine ? " (you)" : "") }),
            h("span", { class: "row-sub", text: (ROLE_LABEL[m.role] || m.role) + " — " + (ROLE_HELP[m.role] || "") })),
          right));
      });
      var seatLine = h("p", { class: "small muted num", text: plural(paid, "paid seat") + " in use of " + ent.seats +
        ". Viewers are free and don't use a seat." });
      var membersCard = card("Members", h("div", { class: "form-grid" }, list, seatLine));

      // invite
      var inviteCard = null;
      var pendingCard = null;
      if (admin) {
        var email = h("input", { class: "input", type: "email", id: "team-email", autocomplete: "off", inputmode: "email", placeholder: "name@example.com" });
        var role = h("select", { class: "select", id: "team-role-new" });
        role.appendChild(h("option", { value: "member", text: "Member — measures and edits" }));
        role.appendChild(h("option", { value: "viewer", text: "Viewer — reads only (free)" }));
        if (ent.role === "owner") role.appendChild(h("option", { value: "admin", text: "Admin — manages the team" }));
        var result = h("div", { class: "team-result", "aria-live": "polite" });
        inviteCard = card("Invite someone", h("div", { class: "form-grid" },
          h("label", { class: "field", for: "team-email" }, h("span", { class: "label", text: "Email" }), email),
          h("label", { class: "field", for: "team-role-new" }, h("span", { class: "label", text: "Role" }), role),
          h("button", { class: "btn btn-primary", type: "button", text: "Create invite code", onclick: function () {
            act(B().invite(email.value, role.value)).then(function (r) { lastInvite = r; load(); }, function () {});
          } }),
          result));
        if (lastInvite) showCode(result, lastInvite);
        if (invites.length) {
          var il = h("ul", { class: "list", "aria-label": "Pending invites" });
          invites.forEach(function (i) {
            il.appendChild(h("li", { class: "list-row" },
              h("div", { class: "row-main" },
                h("span", { class: "row-title num", text: i.code }),
                h("span", { class: "row-sub", text: i.email + " · " + ROLE_LABEL[i.role] })),
              h("button", { class: "btn btn-ghost", type: "button", text: "Cancel", "aria-label": "Cancel invite for " + i.email, onclick: function () {
                act(B().revokeInvite(i.code), "Invite cancelled.").then(load, function () {});
              } })));
          });
          pendingCard = card("Waiting to join", il);
        }
      }
      put(syncCard, shareCard, membersCard, inviteCard, pendingCard, joinCard(), explainer());
    }

    function showCode(result, r) {
      result.innerHTML = "";
      var codeEl = h("p", { class: "team-code num", text: r.code, "aria-label": "Invite code " + r.code.split("").join(" ") });
      var msg = "Join my crew on Apex Measure Pro. Sign in with " + r.email + ", open Settings → Team, and enter this code: " + r.code;
      result.appendChild(h("div", { class: "team-code-card" },
        h("p", { class: "small", text: "Send this code to " + r.email + ". It works once, only for that email, and expires in 7 days." }),
        codeEl,
        h("div", { class: "row-actions" },
          h("button", { class: "btn", type: "button", text: "Copy code", onclick: function () {
            copy(r.code).then(function (ok) { ctx.snack(ok ? "Code copied." : "Couldn't copy — select it and copy by hand."); });
          } }),
          root.navigator && root.navigator.share ? h("button", { class: "btn", type: "button", text: "Share…", onclick: function () {
            try { root.navigator.share({ title: "Apex Measure Pro invite", text: msg }).catch(function () {}); } catch (e) { /* cancelled */ }
          } }) : null)));
      ctx.announce("Invite code " + r.code);
    }

    function copy(text) {
      try {
        if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
          return root.navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
        }
      } catch (e) { /* fall through */ }
      return Promise.resolve(false);
    }

    return load();
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
