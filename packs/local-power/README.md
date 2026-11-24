# Local power pack

On Linux x86-64 or WSL2, start in a checkout with the repository's supported Node, Git, tar and unzip. Planning only reads committed files. Installation needs HTTPS access to the registries and release sources named in each manifest. Plan downloads and disk space separately for embeddings, containers and benchmark results. Without a selected profile the ordinary checkout remains the cloud baseline.

```sh
bash packs/local-power/bootstrap.sh --plan
bash packs/local-power/bootstrap.sh --plan --with gstack,mempalace
bash packs/local-power/bootstrap.sh --with gstack,mempalace
bash packs/local-power/bootstrap.sh --check
PATH="$PWD/.local-power/current/bin:$PATH" npm run agent:target
.local-power/current/bin/claude-local-power
.local-power/current/bin/codex-local-power
```

The launchers use private Claude and Codex configuration homes, absolute stdio commands and the reviewed local settings. Codex needs 0.134 or later for the named profile. Authenticate the private client as needed. Existing personal configuration stays in its original location. To integrate manually, inspect `.local-power/current/{claude,codex}/` before merging desired entries into your own settings. The optional `claude/CLAUDE.local.md.tmpl` contains a project-local instruction example.

The bootstrap holds a checkout lock, verifies release digests or Git commits, installs into permanent private candidate directories and runs a semantic smoke before switching both client configurations together. It excludes user provider keys from recipe environments. Select `nomos` separately to prepare its operator tools. Its verifier, authority configuration and separate deployment steps are described in [the Nomos guide](nomos/README.md). Merely installing the verifier grants no execution authority. AgentShield and SkillEvaluator serve different gates. Tier 2 model use and Tier 3 Harbor/Docker evaluation require explicit operator configuration. Hosted Claude and CI activation are refused.

## Installed capabilities

Use the commands below from a shell with `.local-power/current/bin` on PATH. The two native launchers set that path for their agent.

| Select | What the activation checks and exposes |
| --- | --- |
| `gstack` | Projects review, eval-plan, context-save/restore and the reciprocal review skill into each client. Run `gstack-eval-plan prereg --check FILE --json`. |
| `ecc` | Verifies the separately published Claude and Codex TDD skill bytes. Both clients discover `ecc-tdd-workflow`. |
| `agentshield` | Runs clean and wildcard-permission controls with the frozen scanner. Use `agentshield scan --path DIR --output NEW_REPORT.sarif` to inspect a project. |
| `mempalace` | Retrieves synthetic data through the CLI and a fresh stdio MCP server using CPU embeddings and private Chroma storage. |
| `gbrain` | Imports and retrieves a fixture using embedded PGLite without a provider key. For persistent PostgreSQL install util-linux (`flock`) and Docker Compose. Use `gbrain-pg up`, then `gbrain-pg check` to verify pgvector distance ordering under the application role. `gbrain-pg down` preserves its volume. |
| `skillevaluator` | Validates a Tier 3 dataset with Harbor installed. A reachable Docker daemon enables the shared Tier 1 controls. `qualify-tier2 --help` documents enrollment of the embedding and chat endpoints. |
| `nomos` | Runs upstream signature and trust checks on synthetic receipts. `nomos-receipt self-test` repeats the checks. Deployment, enrollment and live proofs use the separate operator command. |

Controller tests run with `node --test packs/local-power/tests/*.test.mjs` from Linux. The pack's binaries, wheel caches, local model and database are private and can occupy multiple GiB. Benchmark charges depend on the enrolled accounts, model, matrix and execution time.

## Recovery and storage

```sh
bash packs/local-power/bootstrap.sh --disable mempalace
bash packs/local-power/bootstrap.sh --rollback mempalace
```

Disable removes the active registration at the next launch. Rollback switches to the previous installed version, or restores a disabled profile. Neither operation downgrades a storage schema. Back up private data and database volumes before an upstream migration. Use the tool's restore procedure if a previous binary cannot read newer data. Test a new shell after a switch. Running agents retain the generation they started with.

The checkout owns `.local-power/{installs,toolchains,generations,data}`. Failed candidates remain available for local inspection. After interruption, inspect `bootstrap.lock/owner`, confirm the PID and bootstrap process have exited and remove only that lock directory. Keep generations used by running sessions and make a verified backup before reclaiming old data. The pack never prunes Docker volumes. New generations have new private client homes. No process changes the user's shell startup files.

Cloud and core sessions use [the committed baseline](../../docs/system/agent-targets.md). The staged process installer does not distribute this pack.
