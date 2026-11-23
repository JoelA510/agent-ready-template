"""Build both Harbor task arms without starting a container or contacting a provider."""
import json
import sys
import tempfile
from pathlib import Path

from skillevaluator.tier3.harbor.adapter import generate_harbor_tasks


def require(ok, message):
    if not ok:
        raise ValueError(message)


def rehearse(skill):
    evals = skill / "evals"
    dataset = json.loads((evals / "evals.json").read_text())
    by_id = {case["id"]: case for case in dataset["evals"]}
    require(len(by_id) == 10, "expected ten distinct cases")
    base = (evals / "environment/Dockerfile").read_text().splitlines()[0]
    require("@sha256:" in base, "expected pinned base image")
    with tempfile.TemporaryDirectory(prefix="verify-harbor-") as scratch:
        for present in (True, False):
            tasks = generate_harbor_tasks(skill, Path(scratch) / str(present), with_skill=present,
                                          workspace_mode="isolated", grading_mode="default")
            require(len(tasks) == len(by_id) and {p.name for p in tasks} == set(by_id), "incomplete task arm")
            for task in tasks:
                case = by_id[task.name]
                entry = json.loads((task / "tests/entry.json").read_text())
                require(entry["has_skill"] is present and entry["files"] == case["files"], "unexpected arm or fixtures")
                dockerfile = (task / "environment/Dockerfile").read_text()
                require(base in dockerfile.splitlines(), "base image changed")
                treatment = task / "environment/skills/verify"
                for name in ("SKILL.md", "prompts/verify.md"):
                    copied = treatment / name
                    require(copied.is_file() == present and (not present or copied.read_bytes() == (skill / name).read_bytes()),
                            "treatment skill or prompt differs between intended and generated arm")
                source = task / "environment/input"
                files = {p.relative_to(source).as_posix(): p.read_bytes() for p in source.rglob("*") if p.is_file()}
                expected = {Path(name).name: (evals / name).read_bytes() for name in case["files"]}
                require(files == expected, f"fixture mismatch for {task.name}")
            print(f"{len(tasks)} native {'with-skill' if present else 'without-skill'} tasks generated")


if __name__ == "__main__":
    rehearse(Path(sys.argv[1]).resolve())
