---
id: tauri.rust-gates-in-ci
title: CI lints, formats, and tests the Rust side on every pull request
severity: medium
enforcement: check
audit-area: 7
---

**Requires:** a `pull_request` workflow runs `cargo clippy` with warnings denied, `cargo fmt` with
`--check`, and `cargo test`.

**Why:** the Rust side holds the commands the web view can call, the code that touches the file
system. A web-only CI that runs ESLint and Vitest leaves the most dangerous half of the app
unchecked until a release build.

**Meeting it:** `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings` (or
`CARGO_BUILD_WARNINGS=deny cargo clippy` on Cargo 1.97 and later), and `cargo test`, in
`src-tauri/`, in the job that runs on pull requests.

**The check:** looks for each in what `pull_request` workflows run, traced through scripts and
counted only where it can fail the run, and names the ones missing. Warnings count as denied by
`-D warnings` on the command, `CARGO_BUILD_WARNINGS=deny` before it, or `RUSTFLAGS` with
`-D warnings` in the workflow that runs it; a `[lints]` table in `Cargo.toml` isn't read.
`cargo test --no-run` builds the tests without running them, so it doesn't count. A gate counts
for the app's crate (the directory holding its Tauri config) when it runs there, names it
(`--manifest-path src-tauri/Cargo.toml`, read from where the command runs, or from the checkout
through `${{ github.workspace }}`, or `$GITHUB_WORKSPACE` in a POSIX shell), or runs from a
Cargo workspace root that reaches it the way Cargo does: `cargo fmt` formats every member when
run there with no package named and no manifest given, or with `--all` (`-p` and
`--manifest-path` narrow it); clippy and test take the crate with `--workspace` or
`-p <its name>`, or when it's a default member (`default-members`, else every member of a virtual
workspace, else only the root package). A `cd` is followed to a plain path, the checkout's root
(`$(git rev-parse --show-toplevel)`, or the workspace variable), a script's own directory
(`$(dirname "$0")`), `$(pwd)`, a variable set to one of those, or back (`cd -`). A gate run for
another crate, or from a directory the check can't know (any other `cd`, or `$GITHUB_WORKSPACE`
in `working-directory` or PowerShell, where nothing expands it), doesn't count.
