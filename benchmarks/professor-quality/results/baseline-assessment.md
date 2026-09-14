# Frozen Professor V1 blind baseline

Captured on 14 September 2026 with OpenCode 1.18.30 from the clean baseline
commit `84e259b6e9e5a963875e908045bda28536b4aa1c`, before Professor V1.1
runtime, state, or prompt changes. Runs used the isolated Professor harness;
the structured records are in [`runs.jsonl`](runs.jsonl) and the objective
summary is in [`summary.json`](summary.json).

The frozen runner did not pass or record a model or model variant. Its resolved
model is therefore unknown; the OpenCode version alone is not a model-control
record. All post-change runs pass `opencode/muse-spark-1.3-contributor-free`
with variant `xhigh` explicitly.

| Case | Result | Evidence from the frozen run |
| --- | --- | --- |
| B1b | PARTIAL | The report used current official Next.js guidance and identified Cache Components as an opt-in, but did not consistently separate current guidance from legacy/version-specific behavior; it ended with a version-specific research branch that could not be persisted after a source-budget limit. |
| B2b | PASS | The report separated no currently documented supported interface from rewrite roadmap items and a closed MCP PR, and phrased absence as lack of current documentation rather than proof that no interface could exist. |
| B3b | PASS | The report led with the official repository and release record, distinguished a source-build prototype from a usable packaged app, and explicitly labeled the Apple-Silicon issue as community evidence rather than an official requirement. |
| B4b | FAIL | The run reached `verifying` with 20 outer steps, 3 completed tasks, 11 sources, 13 evidence records, and 22 fetches, then timed out before claim verification and report completion. |

The baseline objective totals were 3 completed and 1 incomplete run, 9
completed and 1 failed task, 30 sources, 35 evidence records, 19 findings, 11
claims, 16 searches, and 30 fetches. These are measurement records, not a
claim that the baseline was uniformly correct.
