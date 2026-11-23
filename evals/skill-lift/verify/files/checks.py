"""Deterministic commands for the synthetic pre-commit exercise."""
import json
import sys
from pathlib import Path

case, check = sys.argv[1:]
data = json.loads(Path(__file__).with_name("changes.json").read_text())[case]
if check not in {"lint", "types", "unit", "docs", "generate"}:
    sys.exit("unknown check")
if check == data["fail"]:
    sys.exit(f"{check}: {data['reason']}")
if check == "generate":
    if not data["generated"]:
        sys.exit("no generated output for this change")
    Path(data["generated"]).write_text("menu snapshot version 2\n")
print(f"{check}: passed for {data['file']}")
