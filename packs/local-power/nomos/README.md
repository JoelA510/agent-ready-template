# Nomos local qualification

Use Linux x86-64 with a private Docker daemon and Docker Compose supporting `!override` and `!reset` (2.24.4+). WSL2 is supported with an available Linux daemon. Standard installation freezes the upstream Python environment, installs the receipt reader, verifies independently generated signatures and exercises the effective Compose policy offline. All following commands run from the consumer root after `bootstrap.sh --with nomos`.

```sh
bin=.local-power/current/bin
state=.local-power/data/nomos
"$bin/nomos-receipt" --version
"$bin/nomos-receipt" self-test
"$bin/nomos-operator" render
"$bin/nomos-operator" qualify-images
```

`render` parses the pinned base, sentinel and service overlays plus the pack override, using disposable configuration values. Review `$state/build-overlay.yml` and the private build Dockerfiles. `qualify-images` contacts image and dependency registries and builds the seven local workloads. It binds the Python base and uv executable, then records each resulting Linux image ID with a hash of the checkout and integration inputs in `$state/qualified-images.json`. Each subsequent deployment verifies its rendered and running images. The upstream application builds also use OS/package registries, so a later rebuild can produce different image IDs. Preserve the qualified images and lock together.

**Operator enrollment.** Keep the service home and its Docker socket under the operator’s identity. An account with access to Docker or that home can modify the deployment. This pack therefore reports review/attestation scope, including after a successful fixed-operation proof. Before treating any operation as enforced, place its real resource credentials exclusively in its executor and independently demonstrate denial for the ordinary agent identity. There is no native command fallback for a denied or unreachable executor.

Set `umask 077`. Provision `$state/provider.env` with mode 0600 and one line, `NVIDIA_API_KEY=<private provider key>`, using your secret manager. The upstream default council needs a provider. Running the following commands consents to its costs and sending the fixed smoke intent to it. The upstream startup includes its own authorization/execution smoke. It binds the monitor, gateway, signup and executor to loopback and removes all other host port mappings.

```sh
"$bin/nomos-operator" up --allow-provider
"$bin/nomos-operator" verify --allow-provider
```

For a signed proof, independently verify the Vault transit public keys for the deployed council and executor. Request the reviewed raw Ed25519 public-key bytes from the deployment operator, compare fingerprints through a second trusted channel, and record lowercase 64-digit hex keys in `$state/trust.json` (mode 0600). Pin the actual executor ID, council ID and registered agent from your deployment. Enroll the full HTTPS GitHub repository URL that will appear in the intent. The file has exactly six string fields.

```json
{
  "repository": "https://github.com/OWNER/REPOSITORY",
  "agent": "dev-agent",
  "council": "DEPLOYED_COUNCIL_ID",
  "executor": "DEPLOYED_EXECUTOR_ID",
  "council_public_key": "INDEPENDENTLY_VERIFIED_COUNCIL_KEY",
  "executor_public_key": "INDEPENDENTLY_VERIFIED_EXECUTOR_KEY"
}
```

```sh
"$bin/nomos-operator" prove --allow-provider
```

The proof discovers `council_authorize` over authenticated monitor MCP and requests only `/bin/echo nomos-verify` in `/workspace`. It verifies the original v1 Writ using the enrolled council key and native upstream intent hash, binds command, subject, repository and single-use expiry, and separately calls `POST /v1/writs/execute`. It checks missing/wrong monitor authentication, wrong subject, mutated signature, replay and expiry (up to ten minutes). It accepts only executor-signed, zero-exit evidence for the expected command, argv and output. The pack enrolls this single v1 operation. The upstream structured v2 tool-call Writ has a different signature format and requires its own reviewed enrollment.

`prove` prints two portable link objects and the name of a private proof directory. `writ.json` is the original base64-decoded Writ bytes. `result.json` preserves the HTTP response bytes containing the signed execution evidence. Each `artifact_sha256` covers its whole corresponding file. `intent_hash` comes from upstream intent canonicalization. No council ledger hash is inferred from either artifact. The verifier checks the Writ’s validity at the signed execution time when auditing a historical result. Keep `service.env`, `trust.json`, both raw artifacts and any account tokens in the private home. A reviewed continuity revalidation may import only the two `*.link.json` files with repeated `--attest-file` options.

```sh
"$bin/nomos-receipt" verify --decision-id "$(cat "$proof/decision-id")" --writ "$proof/writ.json" --result "$proof/result.json"
"$bin/nomos-operator" stop
```

Set `proof` to the private directory reported by the successful run. For rollback, stop this project before switching pack generations. `stop` selects running containers by this project’s exact Compose label and preserves images and volumes. Archive the image lock, exported qualified images, service configuration, independently verified trust enrollment and a restorable database backup under the operator’s control. Restore matching state, lock and images before using the previous generation. Upstream’s development Vault is in-memory. Recreating it can rotate keys and invalidate trust. Re-enroll changed keys only after independent verification. A missing key, failed policy, unavailable council, mismatched image or unqualified receipt blocks the protected path.
