# MRT allocation audit (research only)

## Purpose

Compare three historical alternative uses of frozen, pre-start MRT V3 predictions without changing the production V3 model, ticket generator, or site. No betting action, no user-selected manual B mode, no live odds, and no automatic promotion.

- **A**: Original saved 3-ren-tan tickets and yen amounts.
- **B**: For the top three ordered first/second pairs (ranked by saved allocation scores), form up to five unbought third-place completions using the third-position marginal score. Reserve JPY300 per addition and proportionally shrink the original amounts, using JPY100 granularity.
- **C**: Retain the eight highest allocation-score existing tickets and distribute JPY10,000 among them by score, with JPY100 minimum per ticket.

Scores are not calibrated probabilities, and no market odds are used; this is NOT an EV-optimized or validated profitable strategy. B and C are exploratory allocation examples, not a recommendation to bet.

The report's win/loss classes use the actually paid result:
- hit: at least one winning combination already purchased.
- third_miss: exact first/second pair occurred in the original tickets, but no winning combination did.
- reverse_top2: reversed first/second pair appeared.
- two_present: first and second finishers appeared somewhere in one ticket, but not the matching ordered pair.
- not_top2: none of the above.

For dead heats, the accounting sums all legitimate payouts and classifications check every paid combination.

## Run

    python -m unittest discover -s tests/mrt -p 'test_allocation_audit.py'
    python -m mrt.allocation_audit --days 2026-11-22 2026-11-23 --output data/mrt_research/allocation_audit/latest.json

A separate GitHub Actions workflow runs a read-only report into an ephemeral artifact after merge. The workflow has contents: read, does not push any commits, and has no production adoption path. It will compare the latest available frozen snapshots each day, leaving incomplete outcomes unscored.

## Initial 22–23 November 2026 exploratory comparison

| Date | Evaluated | A return / ROI | B return / ROI | C return / ROI |
|---|---:|---:|---:|---:|
| Nov 22 | 47 | 357,710 / 76.1% | 355,030 / 75.5% | 246,830 / 52.5% |
| Nov 23 | 68 | 398,360 / 58.6% | 378,850 / 55.7% | 437,910 / 64.4% |
| Both | 115 | 756,070 / 65.7% | 733,880 / 63.8% | 684,740 / 59.5% |

Each simulated race uses JPY10,000; combined stake JPY1,150,000. Figures are exploratory, from saved source result and forecast JSON with result-payout-based stake accounting. The original November 23 earlier dashboard report has a different return and should not be mixed with these re-computed results without a line-level reconciliation.

**Interpretation:** C improved Nov 23 but failed to generalize to Nov 22; naive third expansion B was worse than A over both days. Do not promote. Use separate future forward audits and group comparisons. With only two days of saved snapshots it is not valid to claim a complete one-month backtest.

## Quality and scope

Exclude missing frozen forecasts, post-close or timezone-invalid timestamps, incomplete result status, invalid or duplicate tickets, invalid stake, invalid 7/9-car roster, and rider registration mismatch; do not count excluded races as misses. Keep raw date-specific output and excluded reasons. Reports include daily results, race-by-race payout, high-payout misses, and top-1/3/5 realized-payout exclusion sensitivity, using common excluded races across variants. The latter is diagnostic only, not an ex-ante purchase filter.

After accumulating sufficient new, time-ordered frozen races, select a candidate protocol before forward validation. Adoption always requires an explicit human decision.


## Teacher versus current MRT on the identical races

Run:

    python -m unittest discover -s tests/mrt -p 'test_teacher_comparison.py'
    python -m mrt.teacher_comparison --output data/mrt_research/teacher_comparison/latest.json

The audit matches the exact frozen MRT prediction to the teacher's retrospectively collected public ticket record, independently verified result payout, and rider IDs. It excludes any unverified race. Teacher records do **not** verify the original publication timestamp; this is a historical comparison, not a proof of independently time-stamped live teacher picks. Never feed the postrace teacher pick back into pre-race predictions.

As of this audit, teacher references exist for November 22 only, 17 records, with 15 pairs having fully verified frozen MRT outcomes. Nov 23 teacher data has not been collected into the repository and therefore is **not** included. The teacher ticket sample is a subset of races, not the complete all-race distribution.

| Identical 15 races (Nov 22) | Teacher | MRT V3 |
|---|---:|---:|
| Stake | 150,000 | 150,000 |
| Return | 216,070 | 99,930 |
| ROI | 144.0% | 66.6% |
| Hit races | 5 | 5 |
| Hits of eight 10,000+ yen payout races | 3 | 1 |
| Mean tickets/race | 22.53 | 20.73 |

Teacher only won 3, MRT only won 3, both won 2, neither won 7. The average *amount of identical ticket stake at minimum of both sizes* is JPY2,200 per race. Thus similar ticket counts do not imply similar bet coverage; the compared content is substantially different. Sample is not adequate to prove durable teacher superiority.

Key teacher-only winning cases:
- Kokura 9R 8-1-5, payout JPY34,540/100, teacher JPY300 stake return JPY103,620: MRT had the ordered 8-1 pair but not third 5.
- Kokura 1R 1-2-9, payout JPY19,170/100, teacher JPY100 stake return JPY19,170: MRT lacked the ordered 1-2 pair.
- Odawara 7R 2-3-1, payout JPY5,980/100, teacher JPY500 stake return JPY29,900: MRT lacked the ordered 2-3 pair.
- Kokura 4R 3-4-8, payout JPY10,040/100: both teacher and MRT purchased JPY400, so both returned JPY40,160.

Implications for the next shadow-only **research proposal**, not yet an adopted algorithm:
1. Identify teacher-only tickets as a distinct learning target by rank and ordered 1/2 pair, especially low-stake upside bets.
2. Separate same ordered pair with missing third (cover selection) from missing ordered 1/2 pair (scenario selection).
3. Analyze B-holder uncertainty and alternate line tactics **only from contemporaneously available inputs**. A teacher's postrace explanations remain labels, not current-race features.
4. Evaluate teacher ticket selection and stake allocation independently; teacher-only winning cases do not justify blanket longshot inclusion.
5. Check wins and ROI by month, 7/9-car, class and realized payout tail, excluding top one/three/five payouts. Require future forward validation and an explicit human production-approval decision.

This comparison is part of the read-only GitHub workflow artifact, under teacher_comparison/latest.json, and intentionally does not modify the MRT engine or production model.
