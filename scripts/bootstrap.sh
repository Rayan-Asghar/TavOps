#!/usr/bin/env bash
# Creates the least-privilege application role.
#
# This script used to generate a fresh random password on every run and only
# print it, which meant `pnpm db:reset` left the app unable to authenticate
# until somebody pasted the new URL in by hand — and the failure looked like a
# broken migration rather than a rotated credential.
#
# It is now idempotent: an existing password is reused, so re-running it (or
# resetting the database) leaves .env.local working.
set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-tavren-db}"
DB_USER="${DB_USER:-tavren}"
DB_NAME="${DB_NAME:-tavren_ops}"
ENV_FILE="${ENV_FILE:-$(dirname "$0")/../.env.local}"

# Precedence: an explicit env var, then whatever .env.local already uses, then
# a freshly generated one.
if [ -n "${APP_DB_PASSWORD:-}" ]; then
  APP_PW="$APP_DB_PASSWORD"
  SOURCE="APP_DB_PASSWORD"
elif [ -f "$ENV_FILE" ] &&
     EXISTING=$(grep -oP '^DATABASE_URL=.*://tavren_app:\K[^@]+' "$ENV_FILE" | head -1) &&
     [ -n "$EXISTING" ]; then
  APP_PW="$EXISTING"
  SOURCE=".env.local"
else
  APP_PW="$(openssl rand -hex 20)"
  SOURCE="newly generated"
fi

docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" \
  -v app_password="'$APP_PW'" -f - < "$(dirname "$0")/bootstrap-roles.sql"

URL="postgresql://tavren_app:${APP_PW}@localhost:5433/${DB_NAME}"

echo
echo "Role tavren_app ready (password from: ${SOURCE})."

if [ "$SOURCE" = ".env.local" ]; then
  # The common case after this fix: nothing to do, the app keeps working.
  echo "DATABASE_URL in .env.local already matches. Nothing to change."
else
  echo
  echo "Put this in .env.local as DATABASE_URL:"
  echo "  ${URL}"
  echo
  echo "Set APP_DB_PASSWORD in your environment to pin it across resets."
fi
