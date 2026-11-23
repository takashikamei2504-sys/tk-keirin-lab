# MRT V3: button-driven current trifecta odds (read-only)

## Architecture

- MRT forecasts and the existing 10,000-yen allocation remain frozen in TK KEIRIN LAB.
- The screen `mrt.html` calls `/api/mrt/live-odds` on the **already-running SHIBUKI Railway service** at `https://shibuki-mobile-production.up.railway.app`. This adapter is isolated in `shibuki-mobile/mrt_live_odds.py` and adds only read-only web functionality to `trial_program_service_20261011.py`.
- It fetches the authoritative pre-start MRT snapshot by race ID from GitHub (never recomputes after a race), and then reads WINTICKET's public racecard and embedded live trifecta quotes.
- The adapter validates exact date, venue, race, start time, rider registration IDs, all 210/504 trifecta outcomes, odds publication timestamp (≤5 min), delayed/final status, and cutoff. CORS only permits the TK KEIRIN LAB page. A global cooldown and 80/day request limit protect existing service resources.
- The browser independently checks the returned model/input/condition fingerprints and quote validity. No persisted prediction is replaced. No bets are placed.
- UI displays reference-only simulations for all 100-yen tickets, a 3,000-yen cap, and a 5,000-yen cap. Score+odds weighting is **not** expected-value optimization: MRT relative scores are not calibrated probabilities. The user must not infer guaranteed returns.

## Deployment

1. The Railway service repo `takashikamei2504-sys/shibuki-mobile` includes the read-only Python endpoint and tests. No new Railway service, volume, or paid subscription is required.
2. Once its deployment passes health checks, `js/mrt/odds-config.js` points at the Railway host:
   ```js
   window.MRT_ODDS_API_URL = 'https://shibuki-mobile-production.up.railway.app';
   ```
3. Button press -> POST JSON `{race_id,mode,line,rule}`; errors (including provider HTML changes, unavailable feed, malformed/stale data, rate limits) display as **見送り** with no stale-data fallback.
4. The displayed quote expires after 5 minutes from publisher timestamp or 30 seconds before cutoff. Preview and copy output carry reference-only labeling. It does **not** affect any of the previous original device forecast snapshots.
5. Operating source requires ongoing review of provider terms and public page structure. Any new paid resource or change to SHIBUKI model execution is out of scope.

## Tests and status

```sh
node tests/mrt/odds-reallocate.test.cjs
```

Backend: `python -m unittest -v test_mrt_live_odds.py` in `shibuki-mobile`. Browser dry run and same-day real provider quote should also be verified from the live deployed service. A passing synthetic parser test is NOT proof that current WINTICKET HTML or odds are accessible. If live odds cannot be authenticated by source and freshness checks, the feature rejects it rather than fabricating values.
