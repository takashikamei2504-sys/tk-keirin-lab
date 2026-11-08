# EX introduction: forward-only forecast accuracy and return-on-stake study

## Objective
Improve the accuracy of the race's leading two finishers and track the return of a consistent trifecta ticket budget, without turning an uncalibrated relative score into a betting probability.

## What changed (2026-11-08)
- `js/ex-profile.js` shrinks numerator/denominator metrics and derives each contextual deviation relative to the **same rider's other observations of that axis**. Overlapping position/grade/bank/weather/session axes are weighted by confidence and **averaged, not summed**. Missing, invalid or few observations are discounted; no 0/0 is read as 0%.
- `js/race-brain.js` conditions the physically possible follow/gap and seat-capture branches on the six original EX tactical outcomes, and applies the restrained conditional win residual to the finish score. It does not equate a tactic's success rate with the frequency with which riders attempt the tactic.
- Pure `js/ex-roi/shadow.cjs` selects eight unique trifecta tickets with first/second pair diversification (max three per pair, max five per first), identically for EX-on and EX-off.
- `scripts/ex-ab-freeze.cjs` uses previously frozen legitimate *pre-race* LAB input and the most recent **pre-race** published EX observation. It makes two fresh engine forecasts at the same clock time, saves only ticket choices and source timestamps, and never consumes results or closing payouts. Records are immutable and keyed by race and an executable-code hash.
- `scripts/ex-ab-evaluate.cjs` later consumes stored outcomes, checks identity and source publication times using the existing ROI audit, and publishes comparable first-place, first-two-place, trifecta, ROI, net yen, maximum drawdown and trimmed top-payout ROI. Each arm simulates eight 100-yen tickets on the same race.
- The live iPhone LAB screen displays actual paired figures **only as they accumulate**.

## Schedule
`.github/workflows/ex-roi-forward.yml` runs daily at 09:45, 12:45, 15:45, 18:45 and 23:45 JST and on successful completion of the source collector, with a cap of 12 new races per run. It uses existing GitHub Actions / Pages, no new paid Railway service, and never makes network requests to WINTICKET from the A/B engine. Run `npm run test:ex-roi`, `npm run ex:ab:freeze`, and `npm run ex:ab:evaluate` locally if needed.

## Promotion threshold (preregistered, cannot be tuned on already scored races)
The EX variant may be **nominated for review** only when:
- At least 200 *paired* pre-race forecasts have been settled, spanning at least 14 distinct racing days.
- An approximately 95% conservative day-cluster lower bound of average paired net yen per race is positive.
- Pair capture is no worse than baseline, and ROI after removal of the single largest winning ticket is no worse than baseline.
- The original input and EX timestamp are both in the past relative to the frozen forecast and the actual race start.

Even if every gate passes, this is a request for human review, NOT an automatic betting activation. The current ROI purchasing policy requires independent calibrated probabilities, as-of odds and its existing prospective readiness gates. It remains untouched. No positive ROI is claimed from the first day's EX source capture.

## Known limitations
- WINTICKET EX historical aggregate windows and concurrent category overlaps may change between race days. These EX counts were newly gathered starting 2026-11-08 and **cannot honestly be backfilled** as if they had been observed earlier.
- The freeze uses the original, earlier LAB public-racecard input for both arms, so the comparison is controlled but is not a replay of every production UI feature or of all current journalism intelligence.
- The result feed is marked public_feed_unverified and subject to existing identity/timestamp checks; do not promote models based on unaudited settlement alone.
- The EX context deviations are a bounded heuristic, not a fitted probability or a causal inference of result.
- Source fields used after race start are ignored; all forecasts remain fixed and never recomputed using actual finish order.

## Outputs
- `data/ex_roi/forecasts/YYYY-MM-DD/<SHA256>.json`: immutable paired picks, original input, model identities and EX as-of source provenance.
- `data/ex_roi/freeze_status.json`: last freezing run and reasons for skips.
- `data/ex_roi/evaluation.json`: validated paired settlement, strict readiness threshold and reference outcomes.
