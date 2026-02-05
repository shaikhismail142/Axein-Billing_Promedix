#!/bin/bash
set -euo pipefail

# Force byte-wise sorting (prevents locale weirdness like 0001b before 0001_init)
export LC_ALL=C

echo "[init] Waiting for postgres to accept connections..."
until pg_isready -U postgres >/dev/null 2>&1; do
  sleep 1
done

echo "[init] Applying migrations to axeindb (sorted)..."
files=(/docker-entrypoint-initdb.d/migrations/*.sql)

# Sort deterministically, then apply in that order
printf '%s\n' "${files[@]}" | sort | while read -r f; do
  base="$(basename "$f")"
  echo "[init] -> $base"
  psql -v ON_ERROR_STOP=1 -U postgres -d axeindb -f "$f"
done

echo "[init] Migrations done."
