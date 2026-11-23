"""Verify the pack's one enrolled v1 operation using the pinned Nomos wire models."""
import argparse
import hashlib
import json
import math
import os
import re
import stat
import sys
import time
from pathlib import Path

from nomos.auth.writ_factory import _compute_intent_hash
from nomos.level_0.types import Intent
from nomos.level_0.types.writ import WritOfExecution
from trusted_executor_contract.models import ExecutionResult

COMMAND = "/bin/echo nomos-verify"
DIRECTORY = "/workspace"
DESCRIPTION = "Print a constant to verify the enrolled repository receipt."


class Rejected(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise Rejected(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def unique_json(raw):
    def unique(pairs):
        values = {}
        for key, value in pairs:
            require(key not in values, "duplicate JSON field")
            values[key] = value
        return values
    return json.loads(raw, object_pairs_hook=unique)


def private_file(path):
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), "rb") as handle:
        info = os.fstat(handle.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o077,
                "private file must be owned by this account with mode 0600 or 0400")
        require(info.st_size <= 1024 * 1024, "oversized artifact")
        return handle.read(1024 * 1024 + 1)


def state_path():
    return Path(json.loads(Path(__file__).with_name("state-path.json").read_text()))


def trust_config(trust):
    require(set(trust) == {"repository", "agent", "council", "executor", "council_public_key", "executor_public_key"},
            "unexpected enrollment fields")
    require(re.fullmatch(r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", trust["repository"])
            and all(re.fullmatch(r"[a-zA-Z0-9_.:-]{1,160}", trust[k]) for k in ["council", "executor", "agent"]),
            "invalid enrolled identifiers")
    require(all(re.fullmatch(r"[0-9a-f]{64}", trust[k]) for k in ["council_public_key", "executor_public_key"])
            and trust["council_public_key"] != trust["executor_public_key"], "invalid independently enrolled public keys")
    return trust


def enrolled_intent(trust, decision_id):
    return Intent.model_validate({
        "intent_id": decision_id, "agent_id": trust["agent"], "council_id": trust["council"],
        "description": DESCRIPTION, "target_resource": trust["repository"],
        "command": COMMAND, "working_directory": DIRECTORY,
    })


def checked_writ(raw, trust, decision_id, at):
    trust_config(trust)
    # Only the scalar v1 shell interface for the fixed no-argument operation is enrolled.
    require("writ_version" not in unique_json(raw), "unsupported Writ format")
    w = WritOfExecution.model_validate_json(raw)
    require(w.verify(bytes.fromhex(trust["council_public_key"])), "untrusted Writ signature")
    require(w.target_agent_id == trust["agent"] and w.council_id == trust["council"]
            and w.intent_hash == _compute_intent_hash(enrolled_intent(trust, decision_id)),
            "Writ subject, audience or intent mismatch")
    require(w.command == COMMAND and w.working_directory == DIRECTORY and not w.packaged_files
            and w.max_executions == 1 and re.fullmatch(r"[0-9a-f]{64}", w.nonce), "unapproved operation")
    require(all(math.isfinite(t) for t in (w.issued_at, w.expires_at, at))
            and w.issued_at <= at < w.expires_at, "Writ outside validity window")
    return w


def receipt(writ_bytes, result_bytes, trust, decision_id):
    unique_json(result_bytes)
    r = ExecutionResult.model_validate_json(result_bytes)
    e = r.evidence
    require(e is not None and e.algorithm == "ed25519" and e.public_key_hex == trust["executor_public_key"],
            "untrusted executor")
    fingerprint = sha(bytes.fromhex(trust["executor_public_key"]))
    p = e.payload
    require(e.key_fingerprint == p.executor_key_fingerprint == fingerprint and e.verify(),
            "untrusted execution evidence signature")
    require(p.signed_at <= time.time(), "execution evidence dated in the future")
    # A historical receipt can be verified after expiry. Its signed execution time must have been valid.
    w = checked_writ(writ_bytes, trust, decision_id, p.signed_at)
    require(p.evidence_version == "v1" and p.executor_id == r.executor_id == trust["executor"]
            and p.writ_id == r.writ_id == w.writ_id and p.writ_signature == w.signature
            and p.intent_hash == w.intent_hash and p.nonce == w.nonce
            and p.council_id == w.council_id and p.target_agent_id == w.target_agent_id,
            "evidence belongs to a different Writ or executor")
    require(p.command.command == COMMAND and p.command.working_directory == DIRECTORY and not p.attachments
            and p.command.shell is False and p.command.argv == COMMAND.split(), "execution command mismatch")
    require(p.result.success and r.success and p.result.exit_code == r.exit_code == 0
            and p.result.verification_stage == r.verification_stage == "passed" and p.result.error is r.error is None
            and p.result.duration_seconds == r.duration_seconds and math.isfinite(r.duration_seconds) and r.duration_seconds >= 0
            and r.stdout == "nomos-verify\n" and r.stderr == "", "expected successful constant-output operation")
    for name in ["stdout", "stderr"]:
        value = getattr(r, name).encode("utf-8")
        require(sha(value) == getattr(p.result, name + "_sha256") and len(value) == getattr(p.result, name + "_bytes"),
                "execution output digest mismatch")
    common = {"system": "nomos", "format_version": "v1", "intent_hash": w.intent_hash,
              "council_id": w.council_id, "writ_id": w.writ_id}
    # A council ledger entry's algorithm-qualified content_hash is a different object.
    return [
        dict(common, kind="writ", artifact_id=w.writ_id, artifact_sha256=sha(writ_bytes),
             issuer_fingerprint=sha(bytes.fromhex(trust["council_public_key"]))),
        dict(common, kind="execution-evidence", artifact_id=w.writ_id, artifact_sha256=sha(result_bytes),
             executor_fingerprint=fingerprint),
    ]


def self_test():
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from trusted_executor_contract.models import ExecutionEvidence, ExecutionEvidencePayload

    council, executor = (Ed25519PrivateKey.generate() for _ in range(2))
    public = lambda key: key.public_key().public_bytes_raw().hex()
    trust = dict(repository="https://github.com/example/fixture", agent="test", council="council",
                 executor="executor-test", council_public_key=public(council), executor_public_key=public(executor))
    now, decision = time.time(), "intent-0123456789abcdef"
    w = WritOfExecution(writ_id="writ-fixture", intent_hash=_compute_intent_hash(enrolled_intent(trust, decision)),
                        command=COMMAND, working_directory=DIRECTORY, target_agent_id=trust["agent"],
                        council_id=trust["council"], issued_at=now - 2, expires_at=now + 60, nonce="01" * 32)
    w = w.with_signature(council.sign(w.canonical_bytes()).hex())
    fingerprint = sha(bytes.fromhex(public(executor)))
    p = ExecutionEvidencePayload(executor_id=trust["executor"], executor_key_fingerprint=fingerprint,
        writ_id=w.writ_id, intent_hash=w.intent_hash, council_id=w.council_id, writ_signature=w.signature,
        target_agent_id=w.target_agent_id, nonce=w.nonce, signed_at=now,
        command=dict(command=COMMAND, working_directory=DIRECTORY, shell=False, argv=COMMAND.split()),
        result=dict(success=True, exit_code=0, verification_stage="passed", stdout_sha256=sha(b"nomos-verify\n"), stdout_bytes=13,
                    stderr_sha256=sha(b""), stderr_bytes=0))
    evidence = ExecutionEvidence(public_key_hex=public(executor), key_fingerprint=fingerprint,
                                 payload=p, signature=executor.sign(p.canonical_bytes()).hex())
    result = ExecutionResult(executor_id=trust["executor"], writ_id=w.writ_id, success=True, exit_code=0, verification_stage="passed",
                             stdout="nomos-verify\n", evidence=evidence)
    writ_bytes, result_bytes = w.model_dump_json().encode(), result.model_dump_json().encode()
    require(len(receipt(writ_bytes, result_bytes, trust, decision)) == 2, "missing positive receipt")
    controls = [
        lambda: checked_writ(writ_bytes, trust, decision, w.expires_at),
        lambda: receipt(writ_bytes, result_bytes, dict(trust, repository=trust["repository"]+"-other"), decision),
        lambda: receipt(writ_bytes, result_bytes, dict(trust, agent="other"), decision),
        lambda: receipt(writ_bytes, result_bytes, dict(trust, executor_public_key=public(Ed25519PrivateKey.generate())), decision),
        lambda: receipt(writ_bytes.replace(w.signature.encode(), b"00"*64), result_bytes, trust, decision),
        lambda: receipt(writ_bytes, result_bytes.replace(evidence.signature.encode(), b"00"*64), trust, decision),
        lambda: receipt(writ_bytes, b'{"success":true,' + result_bytes[1:], trust, decision),
        lambda: receipt(writ_bytes, result.model_copy(update={"verification_stage": "pending"}).model_dump_json().encode(), trust, decision),
    ]
    for control in controls:
        try:
            control()
        except Rejected:
            continue
        raise Rejected("a negative receipt control unexpectedly passed")
    return {"offline_receipts": "passed", "denials": len(controls)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", action="version", version="nomos-receipt 0.1.0")
    actions = parser.add_subparsers(dest="cmd", required=True)
    actions.add_parser("self-test")
    verify = actions.add_parser("verify")
    for field in ["decision-id", "writ", "result"]:
        verify.add_argument("--" + field, required=True)
    args = parser.parse_args()
    try:
        answer = self_test() if args.cmd == "self-test" else receipt(private_file(args.writ), private_file(args.result),
                 trust_config(json.loads(private_file(state_path() / "trust.json"))), args.decision_id)
        print(json.dumps(answer))
    except Exception as exc:
        # Validation errors may contain a bearer Writ, agent credential or private stdout.
        sys.exit(str(exc) if isinstance(exc, Rejected) else "Nomos receipt validation failed")
