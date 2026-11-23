#!/bin/sh
set -eu
# Compose's file secrets retain host ownership. Copy them into container-only tmpfs
# before the upstream entrypoint drops to postgres. The host files can stay mode 0600.
owner_file=/run/gbrain-secrets/owner
install -o postgres -g postgres -m 0400 /run/secrets/owner_password "$owner_file"
install -o postgres -g postgres -m 0400 /run/secrets/app_password /run/gbrain-secrets/app
export POSTGRES_PASSWORD_FILE="$owner_file"
exec /usr/local/bin/docker-entrypoint.sh "$@"
