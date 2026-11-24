# Original Mr.T micro-ticket structure: what is actually supported

Research date: 2026-11-24. This is an observation of historical publicly archived teacher picks, not a ready-to-bet rule.

## 1. Historical evidence

The 7,126-record corpus spans 2025-04-14 through 2026-11-21. Refunds, irregular conditions and records without 3-ren-tan leave 6,923 usable races and 105,569 individual tickets for descriptive accounting. This original corpus is part of the V3 training data and its entries were retrospectively fetched, not independently timestamped before each race.

Small bets (JPY100-300) account for:
- 35,884 tickets (33.99% of historical tickets),
- JPY8,083,300 (11.72% of historical 3-ren-tan spending),
- 117 of the 231 winning ticket combinations with >= JPY10,000 payout per JPY100,
- ROI 92.7% (below 100%).

Of these small tickets, 3,011 (8.4%) share the teacher's *most-funded ordered first/second pair*, whereas 19,431 (54.1%) are a different second-place choice with the same principal first-place rider and 13,442 (37.5%) choose a different first-place rider. Accordingly, adding only third-place completions to the top pair cannot replicate teacher selection.

The first two cars are from different lines in 29,885/35,884 (83.3%) of micro tickets. On the teacher's own cash-ranked top-three first/second pairs, a cross-line micro-ticket subgroup had 10,217 tickets, ROI 111.4% overall; early chronological portion 111.7%, later portion 110.9%. But the exact *teacher cash rank* is an outcome to learn, NOT a usable live feature, and those samples were part of V3's training corpus.

## 2. Actual target 7/9-car subgroup and payout sensitivity

A second audit filters to 7/9 riders without an explicitly girls-class race:
- 6,751 races, 35,144 JPY100-300 tickets, group ROI 91.34%.
- 9,972 cross-line small tickets within teacher's top-three funded pairs, ROI 110.08%.
- Seven-rider subgroup 5,028 tickets, ROI 115.56%; nine-rider 4,944 tickets, ROI 104.47%.
- Early period (through 2026-06-30): ROI 110.46%; later period 2026-07-01 to 2026-11-21: ROI 109.33%.
- Removing the single biggest winning race from this subgroup changes ROI to 100.24%; removing the top three to 88.84%, top five to 80.92%.

So there is a credible *selection hypothesis* around cross-line pair priority, not robust evidence for a profitable policy. Cross-line after-the-fact filter makes the cash-ranked teacher selection rule impossible to deploy without independent pair propensity inference.

## 3. Real same-race teacher-vs-MRT difference, 2026-11-22/23

Of 33 postrace-collected teacher references, 31 pair to an independently saved pre-start MRT V3 snapshot and a verified result; two must be excluded rather than assumed losing.

- Teacher 31 x JPY10,000: return JPY390,560, ROI 125.99%, 9 hits.
- MRT V3 on the **same** 31 races: return JPY192,940, ROI 62.24%, 11 hits.
- Across 13 races paying >= JPY10,000 per JPY100, teacher hit 5, MRT hit 1.

Teacher-only wins:
- 11/22 Kokura 9R: 8-1-5, teacher JPY300 return JPY103,620; MRT had ordered 8-1 but not third 5.
- 11/22 Kokura 1R: 1-2-9, teacher JPY100 return JPY19,170; MRT did not have ordered 1-2.
- 11/23 Tamano 7R: 4-6-5, teacher JPY300 return JPY75,600; MRT had ordered 4-6 but not third 5.
- 11/23 Kokura 12R: 4-3-6, teacher JPY400 return JPY71,560; MRT did not have ordered 4-3.

The old teacher reference's publication times are not independently certified. We compare postrace public reference tickets with pre-start-frozen MRT snapshots, not a pair of independently provable pre-race screenshots.

## 4. Separating hypotheses

### A. Ordered first/second pair selection, not just B-holder prediction

The teacher's most-funded *first-place rider* accounts on average for 74.75% of historical spending; the most-funded *ordered pair* for 43.21%. Thus the teacher is typically broad about which rider can finish second, and allows a smaller counter-scenario with another first-place rider. Micro tickets prefer cross-line first/second positions.

An independently learned pair-propensity model should estimate **P(teacher includes the ordered first/second pair among the three most-funded pairs | entry and lineup)**, not rely on future teacher amounts. Available inputs: car number/line position, membership, pre-race race class, score differences, B/nige/makuri/sashi and top2 rate. No current teacher article, marks, bets, actual B, finish, payout or postrace attributes.

We have prototyped the ordered-pair learner in the research-only script. Historical teacher records through 2026-06-30 are training data; 2026-07-01..11-21 is an in-corpus chronological descriptive validation, and 2026-11-22+ frozen pre-start MRT input is independently evaluated against collected teacher picks. It exports **reports only**, no model for serving.

### B. Third-place tail selection

Given an independently predicted ordered pair, use a second third-position model rather than naive blanket 3rd completion. On teacher-only Kokura 9R and Tamano 7R the existing MRT already covered the correct first/second combination but discarded the actual third. Learn which outside-line or finishing riders to include using only information observable before close. Do not post-select a rule because it would have hit these particular races.

### C. Ticket budget

Historical micro allocations represent a small fraction of stake (11.7% in 7,126-corpus analysis) but many high-payout winning combinations. This does **not** justify immediately reallocating production stake. Compare micro-stake sizes and hit quality separately, include spread across unordered 1/2 outcomes, and examine realized outlier dependence.

## 5. Protocol and production gate

1. Keep MRT V3 untouched. Report line-by-line teacher pair priority and micro third selection.
2. Prioritize ranking fidelity against *later*, still untrained teacher references before checking ROI.
3. Freeze a candidate model and compare on the next 200 eligible races over at least 28 calendar days, grouped by 7/9 riders, class and day, with identical stake and a no-buy option.
4. Reject any candidate that only improves ROI by a single high-payout race. Always show top-1/3/5 realized-payout exclusion sensitivity.
5. Do not claim an expected-value edge without independent pre-close market odds and calibrated winning probabilities. This research deliberately adds no live-odds connection.
6. No automatic production switch. Promotion requires a distinct human decision.

The original data never reveal Mr.T's private thought process. These rules identify *observable selection regularities*; causality or a profitable strategy requires forward testing.
