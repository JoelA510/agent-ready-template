---
pack: python
title: Python projects and scripts
detect:
  - file: pyproject.toml
  - file: requirements*.txt
  - file: setup.py
  - file: Pipfile
  - file: uv.lock
  - file: '*.py'
---

# Python

A Python project, or a repository's Python scripts: dependencies that install the same way twice
and are audited for advisories, and tests that run in CI. Detected from a `pyproject.toml`, `requirements*.txt`, `setup.py`,
`Pipfile`, `uv.lock`, or a `.py` file at the root; scripts kept only in a subdirectory are declared
with a path.
