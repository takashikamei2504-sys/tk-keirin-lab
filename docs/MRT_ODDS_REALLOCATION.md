# MRT V3: on-demand live trifecta odds reallocation (research adapter)

The MRT forecast is immutable: the published V3 automatic/manual-B ticket list and its original ¥10,000 weights remain unchanged. This feature adds a **separate** research-only quote and allocation pane to \`mrt.html\`.

## Flow

1. User selects race and B condition and presses "この条件で買い目を生成".
2. User presses "今の三連単オッズで再配分". Only that click starts a network request.
3. A separate Node 22 HTTP service (\`node server/mrt-odds.cjs\`) fetches the current day's **already-frozen** pre-start MRT snapshot from the existing public repo. No new prediction is calculated.
4. It reuses \`js/roi/odds.cjs\` to read the public, login-free WINTICKET racecard. It requires the same date, venue, race, start time and rider IDs, a complete 210-/504-outcome trifecta market, source odds update time, not-delayed and non-final flags, and sales-close safety checks.
5. The service returns only the quote for the already-selected MRT tickets and source/quote/close timestamps. The browser checks the race/model/condition identity, quote age ≤5 min, and remaining sale time ≥30 seconds.
6. The client creates side-by-side simulations: all tickets at ¥100, ¥3,000 maximum, and ¥5,000 maximum. Minimum ¥100 per ticket; optional extra units are divided using capped, odds-weighted **relative** model score (not calibrated P(win)). Max per-ticket share approximately 20% where feasible. No external bet submission, orders, access credentials or auto purchase.
7. The displayed quote and copy action expire at quote age 5 minutes or 30 seconds before provider cutoff. Failure = **no reallocation**, not silently fall back to stale odds.

**Important:** Relative MRT V3 allocation scores are not calibrated win probabilities. Odds-weighted rank is not mathematical EV optimization. Do not label this output expected return or "buy" readiness. Production 1万円 allocation, model training, and the original on-device first pre-close record are unmodified.

## Hosting and account constraints

GitHub Pages is static and cannot host on-demand odds fetching or bypass cross-origin restrictions. The browser bundle is intentionally disabled until there is an explicitly approved server endpoint:

\`js/mrt/odds-config.js\`:
\`\`\`js
window.MRT_ODDS_API_URL = 'https://YOUR-AUTHORIZED-ODDS-SERVER';
\`\`\`

Node 22 service:
\`\`\`sh
MRT_ODDS_ALLOWED_ORIGIN=https://takashikamei2504-sys.github.io PORT=8080 node server/mrt-odds.cjs
\`\`\`

Do not put API credentials in JS, commit user tokens, or deploy a new paid instance without explicit approval. This PR only creates a **draft interface and server adapter** and does not incur additional Railway costs or touch SHIBUKI. Until hosted and verified against a **live** race the button remains disabled, with an explicit connection status. HTTP fetch failures, site format changes, throttling and upstream access restrictions are expected "unavailable" states and must not be bypassed.

Source terms/robots and operating permissions should be rechecked before enabling. Provider final odds may differ materially from interim odds.

## Verification

\`\`\`sh
node tests/mrt/odds-reallocate.test.cjs
node tests/mrt/odds-server.test.cjs
\`\`\`

Before any public enablement, verify a live 7-vehicle and 9-vehicle race end-to-end including iPhone Safari, new quotes after the button press, no wrong-race quotes, automatic/manual-B conditions, source timestamp, quote expiration, nonexistent odds, invalid roster and 30-second cutoff. Preserve current V3 forecast and freeze ledger. No "higher ROI" claim until a forward evaluation with genuine pre-start inputs, quote timestamps, and payout settlement.
