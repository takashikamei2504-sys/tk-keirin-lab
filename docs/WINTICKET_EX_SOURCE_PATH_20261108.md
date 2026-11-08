# WINTICKET EX source path (2026-11-08)

## Confirmed from independently published source code
- Racecard: https://www.winticket.jp/keirin/{venue}/racecard/{cupId}/{dayIndex}/{raceNo}
- Public HTML embeds window.__PRELOADED_STATE__
- tanStackQuery.queries[] contains FETCH_KEIRIN_RACE
- Its data.records[] stores playerId-indexed EX metrics, joined to players[] and entries[]
- exSpurt -> kamashi; exThrust -> tsuppari; exSplitLine -> chigiri; exLeftBehind -> chigirarare; exSnatch -> tobitsuki
- exCompete -> seri is *candidate only*, not verified against a live source.

## Live source verification, 2026-11-08
One bounded request from GitHub Actions successfully extracted source EX records for **all nine** racers in Yokkaichi 2026-11-08 12R. All six fields were present on all nine records:
exSpurt, exThrust, exSplitLine, exLeftBehind, exSnatch, exCompete.
Each field was an object with the three keys **percentage, succeeded, total**.
Of five semantically confirmed metrics, explicit valid nonzero-denominator pairs were found for:
exSpurt 5, exThrust 5, exSplitLine 7, exLeftBehind 7, exSnatch 4.
No positive-denominator count pair failed consistency checking (tolerance 1.01 percentage points).
ExCompete's numeric *semantics* and source label still require inspection before enabling seri.
The logs include field names and counts only, no individual original figures:
https://github.com/takashikamei2504-sys/tk-keirin-lab/actions/runs/42435285302

This is a source-data path, not a license or permission to harvest.

## Offline importer, preferred for source snapshots you may use
node scripts/winticket_ex_extract.cjs --html ./input/racecard.html --source-url https://www.winticket.jp/keirin/yokkaichi/racecard/2026110548/4/12 --out ./private/winticket-ex-snapshot.json

## Bounded one-page public collector (use only where source conditions permit)
node scripts/winticket_ex_collect.cjs https://www.winticket.jp/keirin/yokkaichi/racecard/2026110548/4/12 ./private/winticket-ex-snapshot.json

One-shot only; no cookies, login, retries, protected API, crawl loop, bot mitigation bypass or redirects. The output is local-only and must not be committed to a public repository. Stop on HTTP 403 and other access restrictions. Check the site's applicable conditions before wider use.

## Data trust rules
- The EX percentage is stored in native 0–100 units; absent remains null; an actual 0 remains zero.
- A denominator is considered available only if source succeeded and total are explicit integers with 0 <= succeeded <= total and total > 0; the displayed percentage must agree with the observed ratio within rounding tolerance.
- Never reconstruct attempts or observed successes from a percentage.
- Do not write raw rate-only snapshots into existing B-AXIS observations, which require verified counts and proper time boundaries.
- Tests use synthetic fixtures, but the live collector separately confirmed the actual 2026-11-08 source field layout.
- The five contextual EX categories require further mapping and source validation.
- Official EX data and independently aggregated result-derived statistics are not interchangeable.

## Validation tasks
1. Single permitted live page fetch and field-level verification; record field names and selected rider count (no raw values in public CI logs).
2. Privately save time-stamped source-linked snapshots with race date and player ID.
3. Inspect exact numerator/denominator semantics and validate metric names against the official presentation.
4. Connect validated numeric observations to B-AXIS's existing provenance checked adapter.
5. Evaluate EX-on/off with forward-time holdouts and ROI metrics, keeping predictions pre-race only.

## References
- https://github.com/nyanta-kun/kiseki/blob/main/keirin/src/scraper/winticket.py
- https://github.com/nyanta-kun/kiseki/blob/main/keirin/docs/data-collection.md
- https://github.com/squidattacker/keirin-prediction/blob/master/winticket/harvest.py
- https://www.winticket.jp/keirin/column/ex_data
