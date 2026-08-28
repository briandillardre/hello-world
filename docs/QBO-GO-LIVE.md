# QBO Go-Live — the 45-minute checklist (Brian)

*Written Aug 28 2026. The integration code (OAuth2, asset sync, job-cost
invoices, expenses, timesheet push) has been live and tested against the
Intuit sandbox for weeks — the ONLY thing missing is an Intuit developer app
with production keys. Until this ships, the marketing "QuickBooks built in"
claim rides on code no customer can connect (Pending #7 / truth-audit note).*

The app expects exactly four env vars (all read in `lib/qbo.ts`):

```
QBO_CLIENT_ID=       ← from the Intuit app's Production keys tab
QBO_CLIENT_SECRET=   ← same tab
QBO_REDIRECT_URI=https://hammertrack.ai/api/qbo/callback
QBO_ENVIRONMENT=production
```

Scope used: `com.intuit.quickbooks.accounting` (accounting only — no
payments scope, which keeps Intuit's review lightweight).

## Steps

1. **developer.intuit.com** → sign in (use brian@hammertrack.ai; create the
   developer account if it doesn't exist — free).
2. **Create an app**: Dashboard → "Create an app" → QuickBooks Online and
   Payments → name it **HammerTrack** → select the
   `com.intuit.quickbooks.accounting` scope only.
3. **Redirect URI** (Development AND Production tabs): add exactly
   `https://hammertrack.ai/api/qbo/callback`
   (Intuit matches verbatim — no trailing slash).
4. **Production keys**: the Production tab requires completing the app's
   details first — App name **HammerTrack**, EULA/privacy URLs
   (`https://hammertrack.ai/terms`, `https://hammertrack.ai/privacy` — both
   pages exist), category (Accounting / Construction), and Intuit's short
   security questionnaire. Accounting-only apps typically clear same-day;
   answer the data questions honestly: OAuth2 tokens stored server-side
   (Supabase, encrypted at rest), no card data, no data resale.
5. **Vercel** → hammertrackjune28 project → Settings → Environment
   Variables → add the four vars above to **Production** (and Preview if you
   want sandbox testing to keep working, use the Development keys +
   `QBO_ENVIRONMENT=sandbox` there instead) → **Redeploy**.
6. **Test the round-trip** (10 min): log into hammertrack.ai →
   Accounting → Connect QuickBooks → authorize against the REAL
   DCG QuickBooks company → confirm: connection card shows the company
   name, asset sync pulls the item list, and one test invoice drafts
   correctly (delete it in QBO after).
7. **Truth sync**: once step 6 passes, the "QuickBooks built in" copy on the
   splash is fully true — no further action. If this checklist stalls past
   ~Sep 15, per the Aug 26 audit the built-in claims get ROADMAP treatment
   instead.

## Gotchas already handled in code

- Discovery-doc endpoints are fetched live with hardcoded fallbacks.
- Token refresh, claim-locked timesheet push (no dupes), and sandbox/prod
  base-URL switching all key off `QBO_ENVIRONMENT`.
- Without the env vars nothing throws — /accounting just shows the connect
  card as unconfigured. Setting the vars IS the launch.
