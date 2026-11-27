# MICRO periodic trifecta odds

Public Kdreams trifecta matrices are captured approximately every 10 minutes
(JST 07:07–23:57), and after a successful coordinated MRT publication.
GitHub schedules can be delayed; the displayed timestamps determine usability.
The capture looks at ready, current-day MRT forecasts closing within 3 hours.
It fetches at most 40 race pages per run, with at least one second between
requests and a four-minute request budget. Recent same-identity quotes are reused
for 10 minutes. HTTP 401/403/429 stops that source without an alternate route.

## Evidence and data

- `data/mrt_odds/snapshots/DATE/RACE/TIME-HASH.json`: immutable full-market
  quotes (210 combinations for seven riders, 504 for nine).
- `data/mrt_odds/plans/DATE/RACE/TIME-HASH.json`: immutable independent plans.
- `data/mrt_odds/latest/RACE.json`: current quote/plan pointer for the viewer.
- `data/mrt_odds/status.json`: counts, bounded failures and source access state.

The source date, venue, race number, start time and all car/name pairs must match
the verified MRT original. Source rider IDs are not claimed: they are carried
from that verified original. Its race/roster/lineup/schedule identity hash must
match the immutable MICRO snapshot. Both matrix orientations are checked against
explicit popularity-list combinations. Missing odds, withdrawals or changed
rosters are rejected, not imputed. Only live, full-pool quotes are usable. Both
capture and publication must be no more than 20 minutes old, and publication
must precede capture. The earlier of provider close and original close applies;
new plans stop two minutes before that time. Final odds never enter a new plan.

Some legacy MRT originals have mark-selector text in their `names` cells. For
these records only, the collector reads the same-day public fixture feed,
requires the same race/date/venue/start time and the exact car-to-rider-ID
mapping, and uses that independent name evidence for the odds roster check.
Feed publication/receipt times and its hash are recorded. The old payload and
its predictions stay byte-for-byte unchanged. No name or rider ID is guessed.

## Price-aware comparison

The original MICRO D is preserved, including its historical protocol ID and
all five research variants. A separate `micro-odds-cover-v1` plan starts from
the existing D tickets and their amounts. It repeatedly removes the ticket
with the lowest protected return until every remaining covered outcome returns
at least 110% of the reduced total stake, using a 20% haircut to captured odds.
Amounts on retained tickets are unchanged; released money is not reinvested.
If no ticket qualifies, the plan skips. It never adds a combination, estimates
EV from imitation scores, changes the fixed trained model, promotes a model or
places a bet. Parameters are explicit research defaults, not optimized proof
of a higher ROI. Losing uncovered outcomes and price changes beyond the haircut
remain possible. The UI labels closed plans as historical and hides an active
plan when stale or close to sales cutoff.

## Verification

```
python -m unittest discover -s tests/mrt -p test_odds.py
node tests/mrt-odds-view.test.cjs
```

`tests/fixtures/mrt-trifecta.html` is the public trifecta section of the
2026-11-26 Toyama 11R Kdreams odds page, used only for layout and ordered-pair
verification. It is not a pre-race market observation and is never fed into
the collector. Synthetic tests cover live/stale/final states, seven/nine riders,
rounding, pre-close identity changes, collection cadence and access denial.

Run `python -m mrt.odds` for the current day. The collector writes only
`data/mrt_odds`; it never rewrites the source MRT or MICRO snapshots.

## Railway runtime

`ops/micro_odds/Dockerfile` builds a Python standard-library service. Run one
replica with `/data` on a persistent volume, sleeping disabled, port 8080 and
healthcheck `/health`. It fetches the current public GitHub manifest, validates
original identity, refreshes MICRO snapshots and reuses `mrt.odds` every 600
seconds. A transient error gets one retry after 60 seconds; access denials wait
for the next regular cycle. No GitHub credentials or betting credentials are
required. Existing collection timestamps survive a restart.

Read-only endpoints: `/api/status`, `/api/latest/RACEID.json`, and daily split
file exports `/api/archive/YYYY-MM-DD` (tar.gz). The API sends no-store and permits
the GitHub Pages origin. No public collection or mutation endpoint exists.
Health indicates process liveness; `/api/status` records collection health.
The twenty-minute price validity guard remains in the browser. A successful
healthcheck alone does not establish successful source collection.

The primary scheduler is Railway. The previous Actions collector is manual
recovery only; `micro-odds-backup.yml` pulls the last three JST days nightly
into separate original JSON files. The UI tries the Railway API first, then
the static archive, with the same identity and twenty-minute freshness checks.
