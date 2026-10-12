---
pack: tauri
title: Tauri desktop apps
detect:
  - file: src-tauri/tauri.conf.json
  - file: src-tauri/Tauri.toml
  - dependency: '@tauri-apps/cli'
---

# Tauri

A Tauri 2 desktop app: a content security policy and narrowly scoped capabilities, which are the
whole boundary between the web view and the machine; an updater key that can't leak and can't be
lost; and the Rust half held to the same CI gates as the web half. Detected from
`src-tauri/tauri.conf.json` or the Tauri CLI at the root.

The checks read the config in any of the three formats Tauri does (`tauri.conf.json`,
`tauri.conf.json5`, `Tauri.toml`, whose keys may be kebab-case), and the capability files likewise.
Platform-specific overrides (`tauri.windows.conf.json` and the like) aren't merged in. Facts are
from Tauri's v2 documentation and source (tauri 2.12), read on 2026-10-07.
