"""Run NVIDIA's native Tier 2 on a fixed, disposable duplicate and unrelated control."""

import argparse
import ipaddress
import json
import math
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit


class QualificationError(ValueError):
    """A diagnostic about this fixture, safe to show without provider output."""


def require(condition, message):
    if not condition:
        raise QualificationError(message)


def endpoint(value):
    url = urlsplit(value)
    loopback = url.hostname == "localhost"
    if url.hostname and not loopback:
        try:
            loopback = ipaddress.ip_address(url.hostname).is_loopback
        except ValueError:
            pass  # A DNS host requires HTTPS.
    if not url.hostname or url.username is not None or url.password is not None or url.query or url.fragment or (
        url.scheme != "https" and not (url.scheme == "http" and loopback)
    ):
        raise argparse.ArgumentTypeError("Use an HTTPS endpoint or loopback HTTP without credentials or query parameters")
    return value


def skill(root, name, description, example):
    path = root / name
    path.mkdir(parents=True)
    (path / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: {description}\n---\n\n# Procedure\n\n{description} "
        "State the answer and identify the observation that supports it. Ask for a missing input before calculating.\n",
        encoding="utf-8",
    )
    (path / "example.md").write_text(example + "\n", encoding="utf-8")
    return path


def run_native(root, env, args, label):
    out = root / (label + "-reports")
    cmd = [str(Path(sys.executable).with_name("skillevaluator")), *map(str, args), "-r", "json", "-o", str(out)]
    # Raw output can quote requests or credentials. Only structural, separately checked outcomes leave the fixture.
    result = subprocess.run(cmd, cwd=root, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            timeout=300, check=False)
    files = list(out.glob("*.json"))
    require(result.returncode in {0, 1} and len(files) == 1, f"{label}: expected one completed native report")
    report = json.loads(files[0].read_text(encoding="utf-8"))
    rows = report.get("results")
    require(isinstance(rows, list) and rows and all(r.get("incomplete_scans") == [] and r.get("skipped") is False
            for r in rows), f"{label}: incomplete or failed provider/evaluator")
    return result.returncode, rows


def detail(row, name):
    return [d.get("metadata") or {} for d in row.get("success_details", []) if d.get("check") == name]


def check_control(code, rows, target, threshold):
    by_name = {r["validator"]: r for r in rows}
    require(len(rows) == 2 and set(by_name) == {"Context Deduplication", "Similarity Check"}, "Tier 2 omitted a stage")
    intra, inter = by_name["Context Deduplication"], by_name["Similarity Check"]
    require(any(d.get("file_count") == 2 for d in detail(intra, "file_collection")) and
            any(d.get("chunk_count", 0) >= 2 for d in detail(intra, "chunking")) and
            intra.get("passed") is True and not intra["legacy"]["errors"],
            "Intra-skill validation did not complete against both fixture files")
    compared = detail(inter, "catalog_compared")
    require(len(compared) == 1 and compared[0].get("target_name") == target and
            compared[0].get("catalog_entry_count") == 1 and compared[0].get("self_matches_excluded") == 0,
            "Report is not a comparison of the selected target and catalog")
    findings = inter.get("findings")
    require(isinstance(findings, list), "Missing similarity findings")
    if target == "weather-forecast":
        require(code == 0 and inter.get("passed") is True and not inter["legacy"]["errors"] and not findings, "Unrelated skill matched or failed")
        return None
    require(target == "archive-copy" and len(findings) == 1, "The duplicate control must have exactly one match")
    info = findings[0].get("metadata") or {}
    score = info.get("score")
    require(findings[0].get("category") == "SIMILARITY" and info.get("entry_a") == target and
            info.get("entry_b") == "archive-lookup" and info.get("comparison_mode") == "target-vs-catalog" and
            type(score) in {int, float} and math.isfinite(score) and threshold <= score <= 1,
            "Expected a scored duplicate against the enrolled reference")
    require(all(findings[0]["message"] in error for error in inter["legacy"]["errors"]),
            "A native error was unrelated to the planted duplicate")
    require(code == (0 if inter.get("passed") else 1), "Report and native exit status disagree")
    return score


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--authorize-calls", action="store_true", required=True,
                        help="authorize synthetic fixture text to be sent to the specified endpoints, with their provider charges")
    parser.add_argument("--embedding-url", type=endpoint, required=True)
    parser.add_argument("--embedding-model", required=True)
    parser.add_argument("--chat-url", type=endpoint, required=True)
    parser.add_argument("--chat-model", required=True)
    args = parser.parse_args()
    env = {key: os.environ[key] for key in ("PATH", "HOME", "LANG") if key in os.environ}
    for role, url, model in [("EMBEDDING", args.embedding_url, args.embedding_model), ("LLM", args.chat_url, args.chat_model)]:
        prefix = "SKILL_EVAL_" + role + "_"
        require(os.getenv(prefix + "API_KEY") and model.strip(), f"Set {prefix}API_KEY and specify a model")
        env.update({prefix + "API_KEY": os.environ[prefix + "API_KEY"], prefix + "BASE_URL": url,
                    prefix + "PROVIDER": "openai-compatible", prefix + "MODEL": model})
    threshold = 0.75
    with tempfile.TemporaryDirectory(prefix="local-power-tier2-") as tmp:
        root = Path(tmp)
        collection, catalog = root / "collection", root / "catalog.json"
        desc = "Retrieve the archive cabinet identifier corresponding to a ledger reference from the courtyard inventory."
        fixture = "Cabinet ZX-14 stores the blueprints. Its capacity is forty sheets and the inventory is updated quarterly."
        skill(collection, "archive-lookup", desc, fixture)
        duplicate = skill(root / "targets", "archive-copy", desc, fixture)
        unrelated = skill(root / "targets", "weather-forecast", "Calculate the chance of freezing fog using humidity and dew point.",
                          "An inland valley cooled to twelve degrees overnight with a west wind of nine knots. The observation station publishes its readings hourly throughout the morning.")
        code, rows = run_native(root, env, ["similarity-check", collection, "--type", "skill", "--save-catalog", catalog], "catalog")
        require(code == 0 and len(rows) == 1 and rows[0].get("passed") is True and catalog.is_file() and
                any(d.get("entry_count") == 1 for d in detail(rows[0], "index_built")), "Could not construct a one-skill catalog")
        results = {}
        for target in (duplicate, unrelated):
            code, rows = run_native(root, env, ["tier2", target, "--catalog", catalog, "--similarity-threshold", str(threshold)], target.name)
            results[target.name] = check_control(code, rows, target.name, threshold)
    print(json.dumps({"status": "qualified", "embedding_endpoint": args.embedding_url, "embedding_model": args.embedding_model,
                      "chat_endpoint": args.chat_url, "chat_model": args.chat_model, "threshold": threshold, "matches": results}))


if __name__ == "__main__":
    try:
        main()
    except QualificationError as exc:
        sys.exit(str(exc))
    except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as exc:
        # Errors can originate in SDK-produced files. Only our synthetic control errors are safe to repeat.
        sys.exit(f"Tier 2 qualification failed ({type(exc).__name__}). Check the configured endpoints and model identifiers.")
