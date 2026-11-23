#!/bin/sh
set -eu
# Compose's file secrets retain host ownership. Copy them into container-only tmpfs
# before the upstream entrypoint drops to postgres. The host files can stay mode 0600.
install -o postgres -g postgres -m 0400 /run/secrets/owner_password /run/gbrain-secrets/owner
install -o postgres -g postgres -m 0400 /run/secrets/app_password /run/gbrain-secrets/app
exec /usr/local/bin/docker-entrypoint.sh "$@"
