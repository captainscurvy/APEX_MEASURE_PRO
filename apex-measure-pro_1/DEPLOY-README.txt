APEX MEASURE PRO — ready-to-deploy bundle
=========================================
This folder is a complete, self-contained deploy of the app, including the
subscription-check function (Stripe is pre-bundled inside it, so NO build or
npm install is needed). You can drag-and-drop this whole folder to Netlify.

DEPLOY (drag & drop)
--------------------
1. Unzip this file.
2. Go to your Netlify site's "Deploys" tab and drag the UNZIPPED "apex-measure-pro"
   folder onto the deploy area (or use https://app.netlify.com/drop for a new site).
3. Wait for "Published".

ENVIRONMENT VARIABLES (set once, in Netlify → Project configuration → Environment variables)
--------------------------------------------------------------------------------------------
  STRIPE_SECRET_KEY = your Stripe LIVE secret key (starts sk_live_...)   [you add this]
  ADMIN_EMAILS      = apexinstallationsok@gmail.com (owner, permanent) [+ others]
Make sure the "Functions" scope is enabled for both.

TEST
----
- Open the site. It asks for your subscription email.
- Enter an admin email (from ADMIN_EMAILS) -> unlocks immediately ("internal").
- Enter a non-subscriber email -> "Subscription inactive" screen.
- If it stays locked on an admin email, the env var isn't set / not Functions-scoped,
  or the function didn't deploy (check Netlify -> Logs -> Functions -> check-access).

NOTE
----
The function file here (netlify/functions/check-access.js) is the PRE-BUNDLED
version for easy deploy. Your project repo keeps the readable source version —
don't copy this bundled file back over it.
