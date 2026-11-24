# 0025. Isolate local agent runtimes per checkout

**Status** Accepted

Local workflow skills, memory backends and evaluation tools require different interpreters, package locks, service credentials and storage lifetimes. A checkout selects its own integrations. The pack verifies pins, installs capability-specific runtimes into private permanent paths, and smoke-tests candidates before publishing native client configurations through one atomic pointer. Permanent paths preserve interpreter shebangs.

The first installation target is Linux x86-64, including WSL2. Embedded retrieval and workflow skills can operate without the container stack. Postgres, authorization services and paid benchmarking each have separate operator prerequisites. A local failure must leave a usable clean checkout and preserve retained database volumes. Shared Core and its CI have no runtime dependency on the pack. A second consumer or independent release need triggers the extraction review in ADR 0022.
