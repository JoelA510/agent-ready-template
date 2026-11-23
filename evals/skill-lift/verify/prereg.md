# Pre-commit verification experiment

Funded enrollment accepts provider-prefixed model snapshots ending in a calendar date (`YYYY-MM-DD` or `YYYYMMDD`) or `@sha256:<64 lowercase hex digits>` for both agents and judges. The operator verifies that the enrolled endpoint serves that immutable ID. Changing any snapshot requires a new continuity revalidation.

## Bars

The primary outcome on each harness is the mean across ten cases of the with-skill pass rate minus the without-skill pass rate. Each case contributes three attempts per arm. A shared-rubric attempt passes only if security and goal accuracy are both 1 and the mean of security, accuracy and the mean of goal accuracy and behavior check is at least 0.8. All four metrics must be measured in each arm. Report the native pass flags separately because native skill-execution dimensions can be unavailable in the control arm. Require complete runs on both harnesses, a point improvement of at least 0.05 on each, a positive lower confidence limit on each and three successful with-skill decoys on each. Otherwise report the outcome as negative or inconclusive, with raw denominators. A rehearsal provides no efficacy evidence.

## Arms

Run Claude Code and Codex separately on identical inputs, using the freeze in benchmark.lock.json. Within each harness use the same model and judge in both arms. Claude Code uses a separately funded OpenAI judge; Codex uses a separately funded Anthropic judge. This keeps judge credentials separate under the pinned evaluator. Evaluate lift within each harness. Absolute scores across judges are ineligible for comparison. The treatment is the repository's verify skill plus its underlying verify prompt. Use the native Harbor without-skill baseline. Disable early stopping, reuse and substitution of timed-out baselines. Run three attempts on each of ten cases in both arms on both harnesses, 120 planned trials. Use one concurrent trial per evaluator. Record installed versions, selected model IDs, evaluator configuration, price basis, and failed or missing attempts. Provider sampling seeds may be unavailable.

## Decoys

The case named unrelated is a language question. Grade it in both arms under the same rubric. A critical with-skill decoy failure bars a positive claim. The nine positive cases cover clean, failing, incomplete and scoped verification work. Use the checked-in fixtures only. They contain synthetic changes and no customer data.

## Comparison

stack: none
why: No additional statistics plugin is loaded. NVIDIA SkillEvaluator 1.0.1 and Harbor 0.25.0 handle the paired runs. Both native harnesses run the same skills, tasks, judge settings and control arms. The local gstack preregistration validator checks this document's structure.

Sort case IDs lexicographically. Bootstrap paired cases with replacement in 10,000 replicates, each with ten draws. Preserve all six outcomes within a sampled case. Restart xorshift32 with seed 0x534B4C46 per harness and select floor(uint32 / 2^32 * 10). For the empirical 95% interval use nearest-rank percentile endpoints at zero-based indexes 249 and 9749. This measures variability over these synthetic cases. Report agent-accounted cost per completed case, labeling judge, retries and runner cost separately.

## Stop rules

Stop before a funded trial unless the exact agent and judge model identities, rates, total provider-enforced cap and enrollment have been reviewed in the lock and the preregistration receipt is HELD. Stop on failing input validation, broken continuity, expired or mismatched enrollment, missing credentials or incomplete evidence. Time limits and agent-only spend estimates supplement the dedicated provider account caps. Keep private provider statements for actual billing reconciliation. Avoid publishing raw trial transcripts or any credentials.

## Held-out exposure

The cases are public and fixed before execution. They are regression tasks, not a blind held-out population. Do not tune the skill, model or judge on these results and present a rerun as confirmatory. Register a distinct new experiment for material changes.
