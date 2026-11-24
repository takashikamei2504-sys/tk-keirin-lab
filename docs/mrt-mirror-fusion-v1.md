# MRT MIRROR FUSION V1 (research only)

This independent engine implements the `quota_hier_bounded` variant:
- Teacher-only hierarchical first / ordered pair / third selection heads.
- Three separate tier selection heads and 7/9-field-specific tier count heads.
- A fixed 10,000-yen paper budget; 100-yen units, duplicate rejection.
- Legal per-ticket bands 100–300 / 400–900 / 1,000+ yen; exact budget.
- Frozen original input provenance, training cutoff 2026-06-30, source/weight hashes.
- A separate forward ledger path; no automatic promotion, no odds, no actual wagers.

## Build and run

Install `mrt/requirements.txt`. From the repository root:

    python -m mrt.mirror_engine train --model research-build/mirror-fusion-v1.joblib
    python tests/mirror_engine_checks.py --model research-build/mirror-fusion-v1.joblib
    python -m mrt.mirror_engine predict --model research-build/mirror-fusion-v1.joblib --snapshot <existing MRT snapshot JSON>

The predict command prints a paper replay JSON (not a pre-start record).
For a genuine prospective freeze only, use the freeze command before the source
snapshot's cutoff, with output under
`data/mrt_research/mirror_fusion/<model SHA256>/<race_id>.json`.
The ledger rejects existing records and late predictions. The CLI is not scheduled.
There is no automatic connection to production, automatic model selection, or UI.

The independent workflow `mrt-mirror-engine.yml` builds the model, performs
7/9-field parity / cutoff / quota checks and packages the weights, manifest and
sample replay JSON as a research artifact. Only load the trusted artifact built
from this code; joblib files can execute arbitrary code on load.

## Empirical context

Stage 3: 4,929 training races through June 30, 2026; 1,002 validation
races (924 strict results); 642 test races (595 strict results).
The fused bounded variant had TEST ticket recall 24.56%, stake overlap 26.11%,
micro recall 13.84%, exact micro-tier recall 6.59%, ROI 65.91%, 10/177
high-payout captures. The hierarchy-only variant had 25.48%, 26.96%,
11.47%, 0.33%, 65.04%, 7/177 respectively. The mixed tier baseline had
20.93%, 23.10%, 5.39%, 0.15%, 74.50%, 9/177.
The fused variant is an explicit research choice, not a claim of best overall
performance. All historical entry data are retrospective and dates were
previously examined. No adoption decision is made from these results.
