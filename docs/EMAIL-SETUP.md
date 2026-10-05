# Email setup (Resend + Netlify DNS)

**Sender:** `mail@apexinstallationsok.com` · **Reply-To:** owner's Outlook · **Provider:** Resend (domain `apexinstallationsok.com`, region us-east-1)

You do not need a Netlify-routed mailbox to send through Resend. Resend only needs DNS records proving you own the domain; the address `mail@` does not need to exist as a mailbox for sending.

## DNS records to add in Netlify DNS

Netlify → Domains → `apexinstallationsok.com` → DNS records → Add new record. Netlify appends the domain automatically, so enter only the name shown.

| Type  | Name               | Value |
|-------|--------------------|-------|
| TXT   | `resend._domainkey` | the `p=MIGfMA0G…` DKIM value from Resend → Domains → apexinstallationsok.com |
| CNAME | `send`             | `send.forge.rmta.net` |
| CNAME | `rsend`            | `rsend.forge.rmta.net` |

Copy the DKIM TXT value from the Resend dashboard (it is long and must not be truncated).

Then trigger verification in Resend (Domains → Verify DNS records). Propagation is usually minutes.

## App configuration

- Netlify env var `RESEND_API_KEY` (secret, Functions scope) — a Resend key restricted to sending from this domain.
- From: `Apex Measure Pro <mail@apexinstallationsok.com>`
- Reply-To: owner's Outlook address (set in the function that sends mail; keep the address out of the repo).

## Not configured on purpose

No MX records and no Resend receiving. Replies reach the owner through Reply-To. If inbound mail to `mail@` is wanted later, enable receiving in Resend and add its MX record.
