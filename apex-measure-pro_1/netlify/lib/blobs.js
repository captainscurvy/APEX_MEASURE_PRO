// Shared Netlify Blobs store accessor.
//
// getStore(name) alone relies on Netlify auto-injecting a Blobs context (siteID + token) into
// the function's environment at runtime. Confirmed via live function logs (MissingBlobsEnvironmentError)
// that this auto-injection isn't happening for this site's deploys — so we configure explicitly
// instead, exactly as Netlify's own error message instructs.
//
// SITE_ID is a standard Netlify-provided env var, automatically present in every deployed
// function — nothing to set up. NETLIFY_BLOBS_TOKEN is NOT automatic: it's a Netlify Personal
// Access Token that must be generated once (Netlify → User settings → Applications → Personal
// access tokens) and set as an env var, the same way STRIPE_SECRET_KEY was set. Never hardcode
// it, never commit it, never paste it anywhere but Netlify's own env var UI/CLI.
const { getStore } = require("@netlify/blobs");

function blobStore(name) {
  const siteID = process.env.SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) return getStore({ name, siteID, token });
  // Fall back to zero-config in case a future deploy path (e.g. a git-triggered build) does
  // support automatic injection — keeps this working either way without another code change.
  return getStore(name);
}

module.exports = { blobStore };
