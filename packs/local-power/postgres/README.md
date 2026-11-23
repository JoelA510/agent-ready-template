# Local gbrain PostgreSQL profile

Install the gbrain pack, then use its versioned launchers on Linux x64 or WSL2. The
ordinary `gbrain` launcher uses the checkout’s embedded PGLite store. Starting the
PostgreSQL profile requires local Docker Compose access and `flock`.

```sh
gbrain-pg up                  # optionally choose a free port on first use with --port 15439
gbrain-pg check
gbrain-pg run sources list --json
gbrain-pg down
```

The checkout has its own Compose project, named database volume and loopback-only port.
The selected port and two randomly generated credentials live under the checkout’s private
`.local-power/data/gbrain/postgres/`. The server copies the mounted mode-0600 secrets to
private tmpfs before it drops to the postgres user. The embedded launcher and the
PostgreSQL launcher each use their own gbrain configuration and database.

On first activation the image initializes pgvector, pg_trgm, pgcrypto and pg_prewarm.
Postgres owns the event trigger that gbrain v35 needs. A separate migration role holds
the BYPASSRLS capability required by the pinned v24 migration. An explicit `up` grants
it a time-limited login while the pinned binary migrates the schema, then disables that
login and returns the trigger function to the administrator. The runtime role owns the
application tables. It cannot create roles or databases, bypass RLS or assume the
migration role. Only use this profile for this checkout’s dedicated database.

`check` authenticates as the application role, checks the disabled migration login,
orders two known vectors by distance and reads the default source through gbrain.
Creating model embeddings requires a separately configured provider. For managed
source imports, inspect `gbrain-pg run sources writer status --json` and follow
gbrain’s owner-claim process for the chosen worktree.

`down` preserves the named volume and credentials. An unavailable daemon affects
this profile alone. Keep a database backup before changing the gbrain version. A
previous launcher restores its code, while a database restore requires its own backup.
