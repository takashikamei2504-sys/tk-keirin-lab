# WINTICKET EX all-11 original fields — live collection and operational controls
Updated: 2026-11-08

## Permission basis
The owner told the assistant on 2026-11-08 that permission had been obtained and directed us to proceed with collection, continuous accumulation and production predictions. The workflow records this as `user-attested-permission-2026-11-08`, **not as a publisher-supplied contract ID or independently audited license**. We have proceeded on the user's representation that permission covers scheduled retrieval, persistent storage, model use and numerical publication. If the actual agreement limits any of those, update the workflow before the next run and remove affected published outputs.

The existing WINTICKET Terms alone do not affirmatively authorize bulk collection. No authentication bypass, anti-bot evasion, hidden API or headless authenticated session is used. The collector uses published HTML and stops on 401, 403 or 429.

## Original source data and structure
The official current-day index at https://www.winticket.jp/keirin/racecard/ embeds direct paths to each active racecard. A one-shot authorized test on 2026-11-08 yielded **83 distinct racecard paths** in a 313080-character HTML response. The static mapping recognizes 43 historical venue codes; the daily index supplies only scheduled active venues and thus does not require thousands of blind requests.

Each source race page has `window.__PRELOADED_STATE__` → `tanStackQuery.queries` → `FETCH_KEIRIN_RACE` → `state.data.records[]`. The pre-race record has playerId and six tactic objects:
- exSpurt = kamashi
- exThrust = tsuppari
- exSplitLine = chigiri
- exLeftBehind = chigirarare
- exSnatch = tobitsuki
- exCompete = competition / seri

Every tactic object has `total,succeeded,percentage`. Only count pairs with denominator > 0 and rate consistent with source are admitted. A zero denominator is not recorded as 0% success.

The five additional EX **source families** exist in the same `records[]` object:
- Position: lineSingleHorseman; linePositionFirst; linePositionSecond; linePositionThird; lineCompete.
- Race type: raceTypeQualifyingRound; raceTypeSemifinal; raceTypeFinal; raceTypeLoserRound; raceTypeSpecial.
- Bank: trackDistance333; trackDistance400; trackDistance500.
- Weather: weatherSunny; weatherCloudy; weatherRainy; weatherSnowy.
- Session: hourTypeNormal; hourTypeMorning; hourTypeNight; hourTypeMidnight; hourTypeSummertime.

Each context object has `first,second,third,others,total,firstPercentage,secondPercentage,thirdPercentage,othersPercentage`. Import requires nonnegative integer counts with `first+second+third+others===total`. Top-three is the sum of the first three. Missing conditions stay missing.

The one-race source smoke test observed nine riders and valid source context buckets: position 25, race-type 44, bank 27, weather 35, session 19. These are condition/rider observations in that particular race, NOT all historical riders or races.

## Scheduled collection workflow
- Workflow: `.github/workflows/ex-approved-ingest.yml`.
- UTC schedule: 00:15, 03:15, 06:15, 09:15 = JST 09:15, 12:15, 15:15, 18:15 each day.
- One index request, up to 130 distinct current racecard paths per run, single-threaded request spacing >=1.5s and a seven-minute collection budget. Targets are discovered by exact venue/cup/day/race URL pattern with strict venue code check.
- On 401 / 403 / 429: stop. On limited single-race parse errors: log counts, continue other active races. No stealth or proxy fallback.
- Source startAt is unix seconds as verified on the 2026-11-08 sample, converted to ISO UTC. The collector excludes races already started at observation time (source-captured timestamp). No post-race results, payoffs or odds are written to this EX pack.
- Data are imported by `scripts/ex_approved_ingest.cjs` with a rights-consistency gate and a source-linked, integer-count guarded bridge.
- `data/ex_approved/latest.json`: latest permitted prior-to-start EX tactical and contextual counts by riderId, last-14-day race weather pointers, cumulative observed venue coverage.
- `data/ex_approved/history/YYYY-MM-DD.jsonl`: append-only dated race snapshots by first observation. This records source and timestamps for forward-time replay.
- `data/ex_approved/status.json`: coverage and last success data.
- Main LAB v1.4 automatically loads the approved pack and adjusts success after tactic selection, leader/follower separation, and contextual top-three evidence. Unavailable source counts leave the baseline untouched.
- B-AXIS uses the same pack. Its EX interaction model becomes the default only when at least one eligible original EX metric exists for that race. Previously saved examples retain baseline behavior.

## Scope and remaining mapping checks
Race Type 'Special' is provisionally mapped to seed/special in the existing LAB nomenclature; this should be cross-checked against WINTICKET label definitions. Source hourTypeSummertime is retained as a separate original bucket. Automatic forecast time-band use is gated until event-specific classification has been validated (a clock-time guess must not be treated as a source-proven class). Similarly, linePositionThird applies to the actual third slot, never automatically to fourth or fifth.

No promise of 43 simultaneous venues: the collector covers every **currently published active venue** within the source-listed racecard budget; lifetime venue coverage grows as events occur. Coverage and data availability must be assessed in the status file, not from a successful scheduled-job badge alone.

## Validation
- `node tests/ex-winticket-all11.test.cjs`
- `node tests/winticket-ex-extract.test.cjs`
- `node tests/ex-approved.test.cjs`
- `npm test`
- Live read-only sample: `node scripts/ex_all11_smoke.cjs` (one source page, field counts only).
- End-to-end live collection: `node scripts/ex_winticket_live_collect.cjs` (requires the workflow permission variables).
