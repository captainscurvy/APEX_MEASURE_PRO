// Shared Netlify Blobs store accessor.
//
// getStore(name) alone relies on Netlify auto-injecting a Blobs context (siteID + token) into
// the function's environment at runtime. Confirmed via live function logs
// (MissingBlobsEnvironmentError) that this auto-injection isn't happening on this site's deploy
// path — not just for the Blobs context itself, but also for the standard SITE_ID env var that
// was supposed to fall back on. So both pieces are now supplied explicitly.
//
// FALLBACK_SITE_ID is NOT sensitive — it's visible in this project's own Netlify dashboard URL
// (app.netlify.com/projects/apexmeasureprogit) and every API response for this project — safe to
// keep in code, unlike the token below. NETLIFY_BLOBS_TOKEN IS sensitive: a Netlify Personal
// Access Token, set as an env var (same way STRIPE_SECRET_KEY was set). Never hardcode it, never
// commit it, never paste it anywhere but Netlify's own env var UI/CLI.
const { getStore } = require("@netlify/blobs");

const FALLBACK_SITE_ID = "9dfe67ac-0d88-4ffd-8320-c2ed06290b82"; // apexmeasureprogit

function blobStore(name) {
  const siteID = process.env.SITE_ID || FALLBACK_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  if (!token) {
    // Makes the next failure (if any) unambiguous: this means the token itself isn't reaching
    // this deploy context, not a siteID problem — check which context set it vs. which context
    // this function is actually running under.
    console.error("blobStore: NETLIFY_BLOBS_TOKEN is not set in this deploy context.");
    return getStore(name); // will throw MissingBlobsEnvironmentError, same as before
  }
  return getStore({ name, siteID, token });
}

module.exports = { blobStore };
