# Inference input hill-climb summary

Generated 2026-08-15. All experiments were shadow evaluations: they did not rewrite OpenHistory timeline, hour, or daily-rollup artifacts.

## Outcome

Promoted production paths:

- **Cloud history:** timestamp-free source observations augmented by a deterministic semantic guide. The guide ranks material work, distinguishes address-bar input from authored content, preserves deleted/final text state, adds evidence-state ceilings, and never replaces the underlying observations.
- **Apple history:** a bounded, focus-only semantic brief with final-state-aware text snapshots. Guided generation produces title and description only; unsupported structured arrays are returned empty.
- **Cloud hour:** metadata-free ordered factual entries, explicit prior-hour isolation, coverage rules, and requested-versus-completed rules.
- **Apple hour:** the same semantic organization in a compact natural-language brief, with title/summary-only guided generation.
- **Cloud day:** unchanged. Two available days did not demonstrate a candidate win.
- **Apple day:** metadata-free hour/session evidence with clearly isolated prior-draft context and title/summary-only guided generation.

## History experiments

Overall pairwise results are candidate wins–baseline wins–ties.

| Experiment | Cloud vs cloud baseline | Apple vs Apple baseline | Apple vs cloud baseline | Decision |
| --- | ---: | ---: | ---: | --- |
| E1: remove timestamps | 2–6–4 | 4–4–4 | 0–12–0 | Reject as a cloud change; neutral cleanup locally |
| E2: replacement EvidencePacket | 0–10–2 | 5–7–0 | 0–12–0 | Reject; compression discarded material evidence |
| E3: hybrid source + guide | 6–3–3 | 8–4–0 | 0–12–0 | First cloud and Apple input winner |
| E4: compact Apple schema | 5–4–3 | 8–4–0 | 0–12–0 | Retain compact schema; Apple calibration won 12–0 |
| E5: ranked compact Apple | 4–5–3 | 7–5–0 | 0–11–1 | Reject |
| E6: focus-only compact Apple | 5–4–3 | 10–2–0 | 0–11–1 | Retain distractor removal |
| E7: consequence-ranked snapshots | 5–3–4 | 10–2–0 | 1–11–0 | Retain snapshot ranking |
| E8: final-state-aware snapshots | 7–2–3 | 11–1–0 | 2–10–0 | Winner |
| E9: composed title fields | 4–2–6 | 11–1–0 | 1–11–0 | Reject; more unsupported and vague titles |
| E8 validation: 20 cases | **12–5–3** | **17–3–0** | 1–18–1 | Promotion gate passed |

The 20-case validation also showed cloud accuracy at 9–4–7 and calibration at 9–2–9. Apple improved substantially over its original input, but it remained materially below cloud quality: its dominant issues were missed secondary work, vague compression, and occasional status overreach.

## Hour experiment

H1, the semantic fixed-hour input experiment, evaluated 12 source-backed clock hours.

| Comparison | Accuracy | Legibility | Calibration | Coverage | Overall |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cloud candidate vs current cloud | 2–1–9 | 4–1–7 | 3–1–8 | 6–4–2 | **7–3–2** |
| Apple candidate vs current Apple | 10–0–2 | 7–5–0 | 12–0–0 | 5–3–4 | **11–1–0** |
| Apple candidate vs current cloud | 1–5–6 | 0–12–0 | 0–10–2 | 1–10–1 | 0–12–0 |

Both candidates were promoted. Apple remains a privacy/offline tradeoff, not a quality-equivalent substitute for cloud hour rollups.

## Daily experiments

Only two complete local days were available, so daily results are directional.

| Experiment | Cloud vs cloud baseline | Apple vs Apple baseline | Apple vs cloud baseline | Decision |
| --- | ---: | ---: | ---: | --- |
| D1: isolated prior context | 1–1–0 | **2–0–0** | 0–2–0 | Promote Apple only |
| D2: remove prior context | 1–1–0 | 1–1–0 | 0–2–0 | Reject; no improvement |

Cloud daily generation remains on its prior input because neither candidate beat it. Apple keeps D1's explicitly labeled prior context because removing it reduced coverage.

## Public-data note

Detailed case reports were intentionally excluded because they were generated from private local activity. This aggregate contains no raw events or prompt payloads. Reproduce evaluations with synthetic fixtures or a private ignored corpus.

## Verification

- `npm test`: 83 TypeScript tests, six deterministic request-preservation checks, and 18 native Swift tests passed after the open-source refactor.
- `npm run build`: native helper packaging and Electron main, preload, and renderer production builds passed.
- `git diff --check`: passed.

## Interpretation limits

- The cloud generator and judge used the configured `gpt-5.6` model. Candidate order alternated, but same-family judging can still share model preferences.
- History validation used 20 source-backed episodes; hour evaluation used 12 source-backed hours; daily evaluation had only two days.
- Apple System Language Model output is much better calibrated after compact guided generation, but it still compresses aggressively and often omits secondary work. The UI should continue describing Apple inference as on-device/private rather than equivalent in quality to cloud inference.
