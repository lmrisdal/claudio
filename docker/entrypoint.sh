#!/bin/sh
set -e

PUID=${PUID:-0}
PGID=${PGID:-0}

chown -R "${PUID}:${PGID}" /config

exec su-exec "${PUID}:${PGID}" /app/claudio-api "$@"
