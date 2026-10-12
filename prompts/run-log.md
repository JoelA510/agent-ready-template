# Prompt run log

One row per run of a project prompt (`new-project.md`, `existing-project.md`), newest last. The
day-to-day prompts (`discovery.md`, `investigate.md`, `review.md`, `pre-pr.md`) aren't logged
here; the PR, issue, or discovery pass they lead to is their record. The point is
recoverability: six months after a stack was chosen or an audit was executed, this is the
fastest path back to what was actually asked, what came out of it, and which references were
current at the time.

Add a row when a run starts, and fill in the outcome columns when it finishes. If a run was
abandoned, say so and why — an abandoned run is often more informative than a clean one.

| Date | Prompt | Target | Inputs (summary) | Outputs | References verified? | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| _yyyy-mm-dd_ | new / existing | repo or app name | one line: what was asked for, key constraints | files or milestones produced | yes (date) / skipped — offline / partial | what changed in the prompt as a result, open items |
| 2026-09-24 | none — a retrospective, not a prompt run | six sibling repos (read-only) | What real use of the prompts and `process:apply` taught, mined from six sibling repos | A series of template PRs. Prompt changes from it: baseline-first audit, refuted/coverage sections, dated `docs/audits/` folders, known-issues input, official docs as yardstick when no reference fits, new audit checks, single-PR plan form | n/a — no references borrowed | One sibling's `docs/audits/2026-07-production-readiness/` is inferred to be a run of existing-project.md (12 areas, same labels and ordering, dated the day of this repo's first commit); it skipped Phase 0 because no reference fit a Vite + Supabase SPA, and was never logged here. |
| 2026-09-27 | new, process only (`process:apply`, then `/bootstrap`) | Shelf, an empty private trial repository (run 1) | A shared pantry and freezer tracker with expiry reminders for a 2-5 person household; web, mobile-friendly; solo developer, free tier only, no accounts connected; template `1.0.0-rc.1` | The delivery (38 files) committed unmodified; `docs/reference-verification.md`; `docs/adr/0001-stack.md` (Proposed: Next.js 16 on Vercel Hobby, Better Auth, Drizzle on Neon Postgres, Node 24); the guardrail files, CI, and the audit gate; `docs/dev-plan.md` (4 milestones). Stopped at the prompt's "Output of this prompt" | Yes (2026-09-27) | 14 template findings, each with cause and impact, in the trial's `docs/template-trial.md`; fixed in the template before run 2. The walking skeleton wasn't built and no account was created. |
| 2026-09-27 | new, process only (`process:apply`, then `/bootstrap`) | Shelf (run 2) | The same inputs; repository visibility and GitHub plan not given; template `1.0.0-rc.1` with run 1's fixes | The delivery (37 files); the same artifact set; ADR 0001 (Proposed: adds Web Push from a daily Vercel Cron job, and Sentry); `docs/dev-plan.md` (3 milestones). Every gate shown failing on a planted defect | Yes (2026-09-27); issue counts from page summaries only, not fully validated | 11 template findings: the ADR template missing from the bootstrap copy list, the skill asking for inputs the prompt says to assume, dependency-policy waivers the audit gate rejected, the session hook ignoring `.nvmrc`, and seven smaller. All fixed in `1.0.0-rc.2`. Assumed GitHub Free. The existing-repository trial is still to run. |

## Longer write-ups

When a run produces reasoning that won't fit in a row — a rejected stack, a migration that was
considered and declined, an audit finding that reshaped the plan — write it up as an ADR in this
repo's decision records (`docs/adr/` in the layout the skeletons use, or wherever the repo
already keeps them) and link the ADR from the row. Keep this table scannable.
