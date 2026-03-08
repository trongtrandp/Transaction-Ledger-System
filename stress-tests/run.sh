#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="${SCRIPT_DIR}/results"
BASE_URL="${BASE_URL:-http://localhost:3000}"
SCENARIO="${1:-smoke}"
SCENARIO_FILE="${SCRIPT_DIR}/scenarios/${SCENARIO}.js"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[k6]${NC} $1"; }
warn() { echo -e "${YELLOW}[k6]${NC} $1"; }
err() { echo -e "${RED}[k6]${NC} $1" >&2; }

# Validate k6 installed
if ! command -v k6 &>/dev/null; then
  err "k6 is not installed. Install: https://grafana.com/docs/k6/latest/set-up/install-k6/"
  exit 1
fi

# Validate scenario file exists
if [[ ! -f "${SCENARIO_FILE}" ]]; then
  err "Scenario not found: ${SCENARIO_FILE}"
  echo "Available scenarios:"
  ls "${SCRIPT_DIR}/scenarios/"*.js 2>/dev/null | xargs -I{} basename {} .js | sed 's/^/  - /'
  exit 1
fi

# Health check
log "Checking app health at ${BASE_URL}..."
RETRIES=0
MAX_RETRIES=10
until curl -sf "${BASE_URL}/health" >/dev/null 2>&1; do
  RETRIES=$((RETRIES + 1))
  if [[ ${RETRIES} -ge ${MAX_RETRIES} ]]; then
    err "App not responding at ${BASE_URL}/health after ${MAX_RETRIES} attempts"
    exit 1
  fi
  warn "Waiting for app... (${RETRIES}/${MAX_RETRIES})"
  sleep 2
done
log "App is healthy"

# Run k6
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTPUT_FILE="${RESULTS_DIR}/${SCENARIO}_${TIMESTAMP}.json"

log "Running scenario: ${SCENARIO}"
log "Output: ${OUTPUT_FILE}"

k6 run \
  --out "json=${OUTPUT_FILE}" \
  -e "BASE_URL=${BASE_URL}" \
  "${SCENARIO_FILE}"

log "Done. Results saved to ${OUTPUT_FILE}"
