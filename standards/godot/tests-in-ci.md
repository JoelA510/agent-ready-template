---
id: godot.tests-in-ci
title: The game's tests run headless in CI
severity: high
enforcement: check
audit-area: 6
---

**Requires:** automated tests for the game (GUT or gdUnit4 for GDScript, a .NET test project for
C#), run by a `pull_request` workflow: `godot --headless` with the test runner, the gdUnit4
action, or `dotnet test`.

**Why:** a game's logic (turn order, damage, saves, economy) breaks in ways that only show up
several minutes into play, which is exactly what manual testing skips. A headless run in CI catches
a regression on the pull request that caused it.

**Meeting it:** GUT (`addons/gut/`, tests extending `GutTest`, run with
`godot --headless -s addons/gut/gut_cmdln.gd`) or gdUnit4 (`addons/gdUnit4/`), or for C# an xUnit
or NUnit project under the game's directory, run with `dotnet test`. Keep simulation logic that
doesn't need the engine in plain classes, so most tests don't need Godot at all.

**The check:** finds tests under the project's path: the GUT or gdUnit4 addon with test scripts, or
a `.csproj` that references xUnit, NUnit, MSTest, or gdUnit4. A test script extends `GutTest` or
`GdUnitTestSuite`, by name or by its `res://addons/...` path. Fails when there are none, or when no
`pull_request` workflow runs them (`gut_cmdln.gd`, gdUnit4's `runtest` or its
`godot-gdunit-labs/gdUnit4-action`, or `dotnet test` naming the path or run in it). GUT also needs
`--headless --import` run in the same job, by whatever name the engine binary has (`godot`,
`godot4`, `Godot_v4.5-stable_linux.x86_64`, `$GODOT`): on a fresh checkout its classes aren't imported, and
`gut_cmdln.gd` exits 0 having run nothing. It can't tell whether the tests cover the game's logic;
that's the audit's question.
