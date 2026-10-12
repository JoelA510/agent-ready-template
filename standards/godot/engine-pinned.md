---
id: godot.engine-pinned
title: CI builds with the engine version the project names
severity: medium
enforcement: check
audit-area: 7
---

**Requires:** the engine version CI installs (a setup action's version, a container image tag, or a
C# project's `Godot.NET.Sdk` version) matches the major and minor version `project.godot` names in
`config/features`.

**Why:** Godot changes behavior between minor versions (physics, resource formats, C# bindings).
A project that runs 4.5 locally and builds on 4.3 in CI ships something nobody tested, and a
resource saved by the newer editor may not load in the older one at all.

**Meeting it:** name the version once and read it in CI: `chickensoft-games/setup-godot` with the
version from `project.godot`, or a container pinned to the same release. For C#, the
`Godot.NET.Sdk/<version>` in the `.csproj` is the pin.

**The check:** reads `config/features` in `project.godot`, then every version CI or the C# project
names: a `setup-godot` step's `version`, the gdUnit4 action's `godot-version`, a
`godot-ci:<version>` or `godot-ci:mono-<version>` image, `Godot.NET.Sdk/<version>`.
Fails on one whose major.minor differs. `n/a` when nothing names a version besides the project.
