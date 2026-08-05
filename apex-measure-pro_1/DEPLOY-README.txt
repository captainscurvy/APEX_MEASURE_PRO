APEX MEASURE PRO — deploy notes
=========================================
IMPORTANT CHANGE from the old bundle: the Stripe secret is NO LONGER pre-compiled
into check-access.js. It now reads STRIPE_SECRET_KEY from a Netlify environment
variable at runtime, same as any normal serverless function. That means a plain
BROWSER drag-and-drop of this raw folder will NOT work anymore — browser
drag-and-drop does not run `npm install` / bundle the function's dependencies
(stripe, @netlify/blobs), it only uploads static files as-is.

Two ways to deploy this correctly:

OPTION A — Netlify CLI (recommended; still a single manual command, your call)
--------------------------------------------------------------------------------
  npm install -g netlify-cli   (once)
  cd apex-measure-pro_1
  netlify deploy --prod
This runs the build (npm install + esbuild bundling) and uploads it — functions
work, and the actual secret VALUE never leaves Netlify's environment-variable
store or touches this folder/git.

OPTION B — Git-connected build
--------------------------------------------------------------------------------
Push this folder to the connected GitHub repo's branch that the Netlify project
is watching. Netlify runs the same npm install + bundling automatically.

Do NOT go back to pre-bundling the Stripe secret directly into the function file
for a browser drag-and-drop — that's the exact pattern that had to be cleaned out
of git before (see repo commit history / project notes). It is not needed anymore:
Option A gives you a one-command manual deploy without ever hardcoding the key.

ENVIRONMENT VARIABLES (set once, in Netlify → Project configuration → Environment
variables → Functions scope enabled)
--------------------------------------------------------------------------------------------
  STRIPE_SECRET_KEY = your Stripe LIVE secret key (starts sk_live_...)
  ADMIN_EMAILS      = comma-separated tester/admin emails
                       (apexinstallationsok@gmail.com is ALSO hardcoded as a
                       permanent admin inside netlify/functions/_verify.js —
                       it never needs to be in this list to keep working, and
                       should never be the only thing protecting it)

TEST
----
- Open the site. It asks for your subscription email.
- Enter an admin email -> unlocks immediately ("internal"), tier defaults to "full".
- Admins get a "Preview tier" toggle to see the Full vs Manual experience.
- Enter a non-subscriber email -> "Subscription inactive" screen.
- Export a priced job -> check the History button on a second "device" (private/
  incognito window, same email) -> the job should appear. If it doesn't, stay on
  the app screen for a few seconds after exporting before switching apps/checking
  downloads — the save request needs a moment to finish sending.
- Toggle the admin "Preview tier" to Manual -> the Connect button should grey out
  and disable, and a small "Upgrade to Full" line should appear. Toggle back to
  Full -> Connect should re-enable. If you were connected to the D2 when you
  switched to Manual, it should disconnect automatically.
- If it stays locked on an admin email, the env vars aren't set / not
  Functions-scoped, or the functions didn't bundle (check Netlify -> Logs ->
  Functions -> check-access — "No functions deployed" means Option A/B above
  wasn't actually used).
