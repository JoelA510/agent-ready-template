# Skill evals

Regression tests for the skills in `.agents/skills/`, run by `claude plugin eval` (Claude Code
2.1.269 or later). A skill only helps when an agent picks it for the request in front of it, and
when the prompt it runs makes the agent do the right thing; neither shows up in a code review of
the change that broke it. These cases call a model, so they cost money and run on demand, not on
every pull request.

- **`routing/`**: one case per skill a model can start on its own, phrased the way someone would
  ask without naming it, graded by whether that skill fired (`tool_used: Skill`, by its namespaced
  name `template-process:<skill>`, so Claude Code's bundled `/verify` can't pass for ours). And
  requests that should start no skill at all (their names start with `no-`). Deterministic
  graders; no judge. `bootstrap` and
  `complete` have none: they set `disable-model-invocation`, so only a person starts them.
- **`behavior/`**: what a prompt makes the agent do, graded by a judge model against a rubric,
  with a deterministic check that the agent read the prompt the skill runs: `plan-change` declines
  to plan a typo fix (Step 0), and `review-change` finds a tenancy hole in a diff. Each case's
  `fixture.sh` copies `prompts/` into the empty workspace (and writes the diff), so it needs
  `--scaffold`. The agent can't write files (only `Read`, `Glob`, `Grep`, and `Skill` are
  granted), so no grader checks for one.

`.claude-plugin/plugin.json` makes the repository a plugin whose skills are `.claude/skills/`, the
copies `npm run skills:build` generates; nothing installs it. `scripts/__tests__/evals.test.ts`
(in `npm run test`, free) checks the suite stays whole: every skill a model can start has a routing
case whose grader names that skill by its namespaced name, every `no-` case only asserts that no
skill fired, and every scaffold script is where its case says.

## Running them

From the repository root, signed in to Claude Code or with `ANTHROPIC_API_KEY` set:

```sh
# The whole suite, once per case, one arm (about $0.70):
claude plugin eval . --scaffold --ablation none --runs 1 --no-publish

# One case while changing a skill's description:
claude plugin eval . --case review-change --runs 3 --ablation none --no-publish

# What CI runs (.github/workflows/evals.yml): three runs a case, every one to pass.
claude plugin eval . --trust-plugin --scaffold --ablation none --no-publish
```

`--ablation none` skips the no-plugin arm: a routing case can't fire a skill that isn't loaded, so
that arm only adds cost. Results land in `evals/results/` (gitignored), with a self-contained
`report.html`. `--keep-temp` keeps each run's workspace and `trace.jsonl`; the run prints how to
remove it.

In CI, the **Skill evals** workflow runs by hand (Actions -> Skill evals -> Run workflow), and
monthly when the repository variable `EVALS_MONTHLY` is `true`. It needs the `ANTHROPIC_API_KEY`
secret and fails without it. The repository variables `EVAL_MODEL` and `EVAL_JUDGE_MODEL`, when
set, pin the model under test and the judge's; otherwise Claude Code's defaults run, which move.
It pins Claude Code itself (2.1.286, the newest release older than the template's seven-day
cooldown when it was written).

What has run (2026-10-08): the whole suite as CI runs it, on 2.1.286, three runs a case. Twelve
cases passed all three; `plan-change-skips-a-small-change` passed two, its judge marking down a
reply that followed the prompt (a first task is part of a small change's output). Its rubric now
quotes the prompt's own output contract, and it passed three of three, and failed with Step 0
rewritten to plan every change. Earlier, on 2.1.293, `review-change` fired in none of three runs
on a pasted diff, and in all three once its description named one.

## Adding a case

After adding a skill a model can start, add `routing/<skill>/` with a `prompt.md` (frontmatter:
`max_turns`, `allowed_tools: [Read, Glob, Grep, Skill]`, `tags: [routing]`; body: the request)
and `graders/skill-fired.md`, copying a neighbor; the test fails until you do. Run it three times
and expect three passes before relying on it. When a routing case fails, change the skill's
`description` in `.agents/skills/`, rebuild (`npm run skills:build`), and run it again: that's how
`review-change` came to say "a pasted diff", after it missed 3 of 3 runs on one.

The contract (fields, grader types, exit codes) is at
https://code.claude.com/docs/en/plugin-evals; checked 2026-10-07.


## Paired Skill Lift on Claude Code and Codex

The manual **Skill Lift** workflow exercises the checked-in [verify preregistration](skill-lift/verify/prereg.md). Its default `rehearse` mode stages the skill and its prompt from the immutable Git tree and validates ten synthetic cases against the pinned evaluator. This path needs no provider account. The GitHub environment `skill-lift` accepts only the protected default branch and requires operator review. The ordinary pull request gates do not dispatch a benchmark.

The [benchmark lock](skill-lift/benchmark.lock.json) records two harnesses, three attempts per arm, case thresholds, evaluator, Harbor and image pins. Provider model IDs, rates, budget and enrollment are unset until a funded experiment has a sponsor. Freeze immutable provider model snapshots and the agent price table in a reviewed pull request. The initial enrollment accepts dated snapshot IDs or content digests. Revalidate its continuity decision against those changes before dispatch. Use a provider-enforced aggregate cap across all four scoped grants, including judges and transport retries. A reported agent spend excludes judge, container and infrastructure costs.

In the protected environment configure `SKILL_LIFT_ENROLLMENT`, `SKILL_LIFT_PROVIDER_CAP_USD`, `SKILL_LIFT_OPENAI_BASE_URL` and `SKILL_LIFT_ANTHROPIC_BASE_URL`. Supply four separate short-lived, task-scoped credentials through the environment secrets `SKILL_LIFT_CLAUDE_TOKEN`, `SKILL_LIFT_CODEX_TOKEN`, `SKILL_LIFT_OPENAI_JUDGE_TOKEN` and `SKILL_LIFT_ANTHROPIC_JUDGE_TOKEN`. Use enrolled endpoints with provider credentials kept outside task containers. The within-harness comparison uses identical judges in both arms. Claude Code has an OpenAI judge and Codex has an Anthropic judge, which lets the pinned evaluator keep agent and judge credentials separate. Compare lift within each harness.

For a local rehearsal, use the pack's activated evaluator or an isolated Python 3.13.18 environment with `pip install --require-hashes --only-binary=:all: -r evals/skill-lift/evaluator.requirements.txt`.

```sh
tree=$(git rev-parse HEAD)
base=$(git rev-parse HEAD^1)
scratch=$(mktemp -d)
node scripts/ci/skill-lift.mjs prepare --skill verify --tree "$tree" --base "$base" --out "$scratch/verify-trial"
skillevaluator tier3 validate "$scratch/verify-trial/verify" --strict
```

Use a fresh private output directory. After a funded run, keep private traces and provider statements under the operator's retention policy. GitHub uploads only the sanitized summary for 14 days. To import a completed run, hash the exact downloaded summary bytes (including the final newline), copy them unchanged to `continuity/evidence/<lowercase-sha256>.json`, and cite that file with the skill, underlying prompt, dataset, preregistration and lock in a new decision. Recheck the digest after copying; use `node continuity/gate.mjs append` and `revalidate` as documented in [the gate guide](../continuity/README.md). An incomplete run has no positive graduation receipt. A change to a cited file invalidates the decision until an actual revalidation.
