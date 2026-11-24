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
