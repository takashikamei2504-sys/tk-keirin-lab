# MRT coordinated runtime

From the existing MRT V3 workflow, collect the current JST entry list and publish
the original snapshots, freeze MICRO and the pinned FUSION independently, reconcile
results, then evaluate and publish the three-way comparison. No prediction logic,
model weights, protocol IDs, or betting functionality are changed.

The primary schedule remains at minutes 04 and 34. As a backup, a successful
main-branch "Collect results and evaluate frozen forecasts" run triggers the same
workflow, only if the latest health report is absent, >=45 minutes old, or
degraded for >=15 minutes. Standalone MICRO and FUSION keep manual recovery
and their validation workflows; their separate cron triggers are removed.
All three share a concurrency group to avoid overlapping writes. GitHub may
delay or omit scheduled events; this does not guarantee availability.

The existing FUSION cache key and active_model.json check remain unchanged.
If the cache cannot be recovered or the hash differs, FUSION fails closed.
The other completed stages persist. Pre-close checks and immutable snapshots
remain enforced. No historical backfill. No automatic promotion.
The runtime status JSON reports stage outcomes, saved counts, missing open
predictions and entry/collection issues. A degraded run exits nonzero after
saving successful data. The workflow commits research and production outputs
together to reduce competing Pages deployments.
