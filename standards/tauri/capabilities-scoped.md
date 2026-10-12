---
id: tauri.capabilities-scoped
title: Capabilities grant no more than the app uses
severity: high
enforcement: check
audit-area: 8
---

**Requires:** no capability grants remote URLs access to commands, whole-disk or home-directory
file access, shell execution of an interpreter or with any arguments, or file-writing or shell
permissions to every window (`"windows": ["*"]`).

**Why:** a capability is what the web view may ask the Rust side to do. Each broad grant turns a
cross-site scripting bug into reading the user's home directory or running a shell.

**Meeting it:** grant per window, by name; scope fs permissions to the app's own directories
(`fs:default` is read-only and app-scoped); give `shell:allow-execute` a scope of named programs
with fixed or validated arguments.

**The check:** reads the JSON, JSON5, and TOML files under `capabilities/` beside the config (each
holding one capability, a list, or `{ "capabilities": [...] }`), and capabilities inline in it.
Flags `remote.urls`; `fs:allow-home-read-recursive`, `fs:allow-home-write-recursive`,
`fs:scope-home-recursive`, or a scope (a path, or `{ "path" }`) of `$HOME`, `$HOME/**`, `/`, `/**`,
or `**`; a shell scope
with `"args": true` or an interpreter as its command (`sh`, `bash`, `zsh`, `fish`, `cmd`,
`powershell`, `pwsh`, `python`, `node`, `osascript`); and fs-write, remove, rename, or shell
execute permissions for `"*"` windows. `fs:read-all` and `fs:write-all` aren't flagged: they enable
commands, and reach only the paths a scope grants. It can't see commands a handler exposes without a capability, which a plain `tauri_build::build()`
allows for every registered command.
