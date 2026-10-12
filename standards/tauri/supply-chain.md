---
id: tauri.supply-chain
title: CI checks the Rust dependencies for advisories
severity: medium
enforcement: check
audit-area: 8
---

**Requires:** a workflow (on pull requests or a schedule) runs `cargo deny check` or `cargo audit`
against the app's `Cargo.lock`.

**Why:** `npm audit` doesn't see crates. A desktop app ships its Rust dependencies to every user's
machine with the user's permissions, and RustSec publishes advisories for them the same way GitHub
does for npm.

**Meeting it:** `cargo deny check` with a `deny.toml` beside `Cargo.toml` (or above it), or
`EmbarkStudios/cargo-deny-action@v2` with `manifest-path: src-tauri/Cargo.toml`: its default,
`./Cargo.toml`, is wrong for most Tauri apps.

**The check:** looks for `cargo deny check`, `cargo audit`, `EmbarkStudios/cargo-deny-action`
(with a `manifest-path` that exists), or `rustsec/audit-check` in workflows triggered by pull
requests or a schedule, counted only where it can fail the run. A `cargo deny check` that names its
checks (on the command, or in the action's `command`) has to include `advisories`:
`check licenses bans` doesn't read RustSec. Commands are matched to the app's crate as
`tauri.rust-gates-in-ci` matches them, except at a workspace root: `cargo audit` reads the lock
file every member shares, and `cargo deny` takes every member of a virtual workspace, at a root
package only with `--workspace` (it has no `-p`), and never one it `--exclude`s. The
`cargo-deny-action` counts the same way, from its `manifest-path` (`./Cargo.toml` by default)
and its `arguments`.
