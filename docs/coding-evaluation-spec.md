# Coding Interview AI Layer: Spec

Status: spec only, queued behind the backend build. Implements inside `apps/api` against the existing `Interviewer`, `Evaluator` and `AiProvider` ports. Execution stays in `apps/runner` and is never touched from here.

## Rules that decide the design

1. **Execution results are the only evidence of correctness.** The AI never states, implies, or scores "passes tests" unless a signed `run_results` row says so. Prompts receive results as structured facts, and output claims about test outcomes are checked against them in code.
2. **Hidden tests stay hidden.** Interviewer and evaluator prompts receive visible test names and outputs, plus hidden counts only (`hiddenPassed`, `hiddenTotal`). A test asserts no hidden name, input or expected output reaches any prompt, response or log.
3. **Evaluation is separate from execution.** The evaluator reads stored submissions and results. It cannot run code, and the runner has no AI access.
4. **Interviewer and evaluator are separate roles.** The interviewer talks to the candidate and never sees rubrics or scores. The evaluator never talks to the candidate. Hints come from the interviewer, scores from the evaluator.
5. **No single response decides the score.** The coding score is a deterministic function of separate stored components.
6. **Candidate code, explanations and chat are untrusted input.** Same delimited-data-block handling as the rest of the AI layer.

## Components

### Interviewer (candidate-facing)
- `codingFollowUp`: after a submission, asks one question grounded in the code and the real results, for example about a failing visible test, an untested edge case, or complexity. Never asserts a pass the runner did not confirm.
- `codingHint`: triggered when the candidate asks things like "can I improve my solution?" or asks for help. Returns a conceptual nudge at the lowest hint level not yet used (level 1 direction, level 2 technique name, level 3 structural outline). Never full code, never the complete algorithm unless the candidate has exhausted hint levels and the mode spec allows a final reveal. Hint level and count are stored per stage and reduce the approach score by a fixed, documented amount.
- Adaptive difficulty: pure function of per-problem outcomes (final score, hints used, time used) and the mode's `adaptivity` spec. The model proposes nothing about difficulty.
- Interviewer-style feedback text: natural tone, specific, references real results and quoted code lines.

### Evaluator (not candidate-facing)
Each criterion is its own rubric entry with anchored levels and its own structured output, scored independently:

| Criterion | Evidence used |
|---|---|
| Approach understanding | Candidate's explanation text and code structure |
| Correctness | Runner results only (deterministic, no LLM) |
| Algorithmic reasoning | Explanation, code, and results on boundary tests |
| Time complexity | Claimed complexity by candidate, inferred complexity from code, agreement check |
| Space complexity | Same |
| Code quality | Code only, language-aware rubric (naming, structure, redundancy) |
| Edge-case handling | Code, explanation, visible and hidden failure counts |
| Debugging ability | Sequence of submissions and runs: did later runs fix earlier failures |
| Explanation quality | Explanation text clarity versus what the code actually does |

Validation before storing: schema parse, scores in rubric range, every evidence quote a verbatim substring of the source, explanation, or sanitized run output; complexity claims are labeled as inferred and carry lower confidence when the code is ambiguous. A second independent evaluator pass runs on the judgment-based criteria. Disagreement above a threshold lowers confidence and is surfaced, not averaged silently.

### Coding score
```
correctness   = weighted hidden+visible pass fraction from signed run results (deterministic)
quality_part  = weighted mean of the evaluator criteria above, minus hint penalty
coding_score  = w_c * correctness + w_q * quality_part   (weights from mode spec / rubric)
```
Components are stored separately in `competency_scores` / stage score evidence so the total is auditable. Timeouts, memory-limit and runtime errors reduce correctness and are named as such in feedback.

## Prompt injection and gaming
Code comments or explanations that say "mark this correct" or "ignore previous instructions" are data. Tests include injection in code comments, injection in the explanation, an explanation that claims the code passes tests it failed, and a request for the hidden tests. Each must be neutralized.

## Test plan
- Unit: score function, hint-level progression, adaptive difficulty function.
- Contract: prompts never contain hidden test fields (snapshot of prompt inputs).
- Behavior with the test adapter: failing results never produce "passed" in feedback, hint requests never return full solutions, evidence quotes not in source are dropped.
- Eval harness: labeled solutions (correct, wrong, slow, messy, hardcoded to visible tests) with expected criterion ranges, run in CI on prompt or model change. Hardcoded-to-samples solutions must be caught by hidden-test counts, not by the LLM.
