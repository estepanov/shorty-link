#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-3000}"
DOCS_URL="http://localhost:$PORT/api/docs/json"
OPENAPI_FILE="openapi.json"
POSTMAN_FILE="postman-collection.json"

echo "Starting dev server on port $PORT..."
pnpm dev --port "$PORT" &
DEV_PID=$!

# Wait for the server to be ready (poll /api/health)
echo "Waiting for server..."
for i in $(seq 1 30); do
	if curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
		echo "Server ready."
		break
	fi
	sleep 1
done

# Fetch OpenAPI spec
echo "Fetching OpenAPI spec from $DOCS_URL..."
curl -sf "$DOCS_URL" >"$OPENAPI_FILE"
echo "✅ $OPENAPI_FILE generated"

# Convert to Postman collection
echo "Generating Postman collection..."
npx --yes openapi-to-postmanv2 \
	-s "$OPENAPI_FILE" \
	-o "$POSTMAN_FILE" \
	-p 2>/dev/null || npx openapi-to-postmanv2 -s "$OPENAPI_FILE" -o "$POSTMAN_FILE"
echo "✅ $POSTMAN_FILE generated"

echo "Formatting OpenAPI and Postman JSON for Biome CI..."
pnpm exec biome format --write "$OPENAPI_FILE" "$POSTMAN_FILE"

# Cleanup
kill $DEV_PID 2>/dev/null || true
echo "Done."
