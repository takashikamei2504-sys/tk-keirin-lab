# EX licensed collector and five contextual categories — 2026-11-08

## Current live state
- Previous one-shot WINTICKET source verification succeeded for six fields in one Yokkaichi nine-rider race.
- Bulk collection permission, repeated requests, long-term storage, derivation/model training and redistribution were **not** verified by the one-shot test.
- The production every-three-hour GitHub Actions job runs in **fail-closed** mode. With no source license + separately configured approved feed, it performs no WINTICKET requests and publishes no proprietary EX values.
- GitHub Pages baseline will continue unchanged while the license gate is false.
- Railway SHIBUKI and its 5GB volume are unrelated and are not modified. This implementation uses the existing GitHub Actions budget / GitHub Pages deployment only.

## Regulatory / contractual check
Official WINTICKET Terms: https://www.winticket.jp/terms (February 1, 2026 revision).
Article 14 establishes ownership of service content. Article 15(4)(1), (4), (5) and (6) address unauthorized conduct outside service scope, infringement, program/other analysis and interference. The terms do not provide an affirmative right to automated bulk retrieval or republication.
The service may publish information freely for viewing; *availability in an HTML response does not itself authorize 43-venue bulk collection or redistribution*. Written permission / an appropriately licensed distributor or equivalent authorization is still needed.
No prohibited network access, authentication bypass or non-public endpoints are used by the scheduled job.

## EX data source structures
Confirmed by the official EX explanation: https://www.winticket.jp/keirin/column/ex_data
- position: leader, second, solo, contested (official positions)
- race type: qualifier, semi, final, seed, consolation
- track length: 333m / 400m / 500m
- weather: sun / cloud / rain
- session: morning / day / night / midnight

**Source paths for these five contextual categories have not been established.**
Six tactical metrics were found directly at `FETCH_KEIRIN_RACE.state.data.records[].exSpurt/exThrust/exSplitLine/exLeftBehind/exSnatch/exCompete`.
Each has `percentage`, `succeeded`, and `total`, but their presence does NOT locate condition tables. In the previous nine-rider source probe there were no other `ex*` keys at this `records[]` level.
Do not represent independently computed role/round/track/session results as WINTICKET's original context figures.
Local-only inspection: `node scripts/ex_context_shape_audit.cjs <authorized-snapshot.html-or-state.json>`; it reports only paths/types and never makes network requests.
The exact five source paths require operator-authorized samples from their EX tabs or explicit publisher documentation.

## Production pipeline design
- Scheduled every 3 hours using `.github/workflows/ex-approved-ingest.yml`.
- Feed input is from an **authorized external HTTPS provider** (never `winticket.jp`), with strict hostname matching, no redirect, no retries, capped content.
- Explicit configuration: GitHub Actions variables `EX_BULK_RIGHTS_APPROVED=true`, `EX_PUBLICATION_RIGHTS_APPROVED=true`, `EX_FEED_HOST=<approved provider hostname>`; secrets `EX_FEED_URL` and `EX_RIGHTS_REFERENCE`.
- Matching feed license metadata must attest bulk acquisition, model use, publication and reference/expiry. A checkbox/secret is not itself proof of a license; do not set these before an actual agreement.
- Input schema `tk-winticket-ex-authorized-feed/v1`: `{schema, license, snapshots:[{venue,date,race_no,race_start,snapshot}]}`, where snapshot is `tk-winticket-ex-raw-snapshot/v1`.
- Only pre-race, rate-consistent numerator/denominator pairs are used, source-linked by riderId and timestamp. Invalid and zero-denominator inputs do not appear as 0% successes.
- On successful authorized runs, snapshots are merged to `data/ex_approved/latest.json` and append-only dated files in `data/ex_approved/history/YYYY-MM-DD.jsonl`. Venue / race / rider counts and coverage are shown in `status.json`.
- All reported coverage is **observed coverage**, never automatically labeled 43/43. To achieve all-venue coverage, the licensed provider must deliver every scheduled race in its feed. Monitoring must compare against independent event schedules.
- Front-end B-AXIS and main v1.4 load the same approved pack. Without valid license metadata both use their existing baseline.
- For model inference, conditional EX success rates change outcomes after a tactic has been selected (kamashi/tsuppari), line break/track when acceleration occurs (chigiri/chigirarare), and seat capture conditional on a physically feasible scenario (tobitsuki). They are NOT assumed to be tactic selection frequencies.
- Validate the source's counting window; daily updated values may include earlier races and must not be retroactively used in prior forecasts.

## Verification
Run `node tests/ex-approved.test.cjs` and existing `npm test`.
Synthetic fixtures show model behavior, not actual ROI. Only forward-time predictions on source-linked, pre-race numeric observations establish real effects.
