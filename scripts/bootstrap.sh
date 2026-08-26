#!/usr/bin/env bash
# Creates the least-privilege application role and prints the connection URL.
set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-tavren-db}"
DB_USER="${DB_USER:-tavren}"
DB_NAME="${DB_NAME:-tavren_ops}"

APP_PW="${APP_DB_PASSWORD:-$(openssl rand -hex 20)}"

docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" \
  -v app_password="'$APP_PW'" -f - < "$(dirname "$0")/bootstrap-roles.sql"

echo
echo "Role tavren_app ready. Put this in .env.local as DATABASE_URL:"
echo "  postgresql://tavren_app:${APP_PW}@localhost:5433/${DB_NAME}"
