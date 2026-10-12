---
id: python.locked-dependencies
title: Dependencies are locked to exact versions
severity: medium
enforcement: check
audit-area: 8
---

**Requires:** a lockfile (`uv.lock`, `poetry.lock`, `pdm.lock`, `Pipfile.lock`) for a project that
declares dependencies in `pyproject.toml` or a `Pipfile`, and `==` pins on every line of a
`requirements*.txt`.

**Why:** a `>=` range installs whatever is newest on the day, so a fresh environment isn't the one
that was tested, and a compromised release arrives automatically.

**Meeting it:** `uv lock` (and `uv lock --locked` in CI to keep it current), or `pip-compile` to turn
a loose requirements file into a pinned one.

**The check:** reads `pyproject.toml` and a `Pipfile` at the project's path, and every
`requirements*.txt` below it (virtual environments left out). It reads `pyproject.toml` as text,
looking for a non-empty `dependencies` list or Poetry dependencies other than `python`. `n/a` when
nothing third-party is declared.
