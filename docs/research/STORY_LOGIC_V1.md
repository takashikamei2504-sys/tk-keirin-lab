# LAB STORY LOGIC V1 — independent research protocol

Status: research design only; no external corpus imported, no model trained, no production changes.
Priority: reproduce decision logic for a given race; race selection is deferred.

## Data permissions gate
Use only datasets explicitly authorized for the intended storage and analysis/training scope. Public visibility does not establish permission for bulk copying, training or redistribution. Do not commit external prediction texts, derived source-specific datasets, or access credentials to this public repository. No acquisition job may run until the source's permissions and allowed access method are documented. Synthetic fixtures and independently licensed race data may be used for development.

## Independent representation
- race: race_id, start_at, field_size, grade, round, venue, lines, pre-race evidence timestamps
- rider: stable rider_id, role, recent race-content observations, tactics, position tendencies, finishing strength, provenance
- hypothesis: ordered events with actor, action, phase, preconditions, opposing response, consequence, uncertainty and evidence references
- target labels (authorized only): lead line, decisive maneuver, favored rider, expected finish structure, ticket type, distinct combinations, stake weights
- result: separately stored after race; never input to pre-race inference
- missing evidence: UNKNOWN, never silently zero or inferred personal relationships

## Experiments
1. Audit permission and coverage; distinguish absent prediction, inaccessible page and unavailable detail.
2. Annotate authorized examples with a fixed taxonomy: early position, lead contest, attack timing, following ability, position contest, counterattack, sprint, independent rider opportunity, reversal conditions.
3. Measure annotator agreement; retain uncertainty rather than fabricating events.
4. Build rider tendencies from only earlier races. Generate competing hypotheses and score evidence, feasibility and counterevidence. Compare to existing LAB LINE without modifying it.
5. Chronological train/validation/test split; freeze test labels and configuration. Separate 7/9 car and class. Evaluate favored-rider agreement, lead-line agreement, maneuver agreement, ordered finish structure and ticket overlap separately. A matched bet alone does not establish matched reasoning.
6. Compare independent forecasts to actual results using outcome accuracy and simulated equal-budget returns; report sample size and largest payout exclusions. Treat past prices as historical observations only; no claims of future returns.
7. Race-selection experiments only after logic validation. No live betting integration.

## Acceptance
- No look-ahead features or result leaks.
- Synthetic tests verify chronological gating, valid line/rider references, incomplete evidence handling and no duplicate outcomes.
- No production deployment or existing prediction history modification.
- Clearly distinguish observed results, hypotheses and unvalidated behavior.
