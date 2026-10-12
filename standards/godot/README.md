---
pack: godot
title: Godot projects
detect:
  - file: project.godot
---

# Godot

A Godot 4 project, in GDScript or C#: tests that run headless in CI, and one engine version used
locally and in CI. Detected from `project.godot` at the root; a game kept in a subdirectory
(`client_godot/`) is declared with a path.

C#-only projects are common, so the checks look for .NET test projects (`dotnet test`) as well as
the GDScript test addons, GUT and gdUnit4.

There's no standard way to check that a simulation is deterministic across operating systems:
Godot's built-in physics isn't, and a golden-hash replay is each project's own design. A project
that depends on it should run its replay on each OS in CI, and the audit should ask whether that
replay can fail.
