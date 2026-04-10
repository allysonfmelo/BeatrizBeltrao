#!/usr/bin/env bash
# ============================================================================
# deploy-vps.sh — Deploy manual da API Docker na VPS
#
# Contorna o bloqueio de firewall na porta 22 que impede o GitHub Actions de
# fazer SSH direto. Este script:
#   1. Descobre o SHA do commit alvo (argumento ou HEAD atual)
#   2. (opcional) Aguarda o workflow do GitHub Actions publicar a imagem no GHCR
#   3. Faz SSH na VPS e executa `docker service update` com a nova imagem
#   4. Valida convergência + health check
#
# Uso:
#   scripts/deploy-vps.sh                  # deploy do HEAD atual (aguarda CI)
#   scripts/deploy-vps.sh --no-wait        # deploy imediato, sem esperar CI
#   scripts/deploy-vps.sh <sha>            # deploy de um SHA específico
#   scripts/deploy-vps.sh <sha> --no-wait  # SHA específico, sem esperar CI
#
# Pré-requisitos:
#   - ~/.ssh/bb_deploy_key (chave SSH configurada)
#   - gh CLI autenticado (para --wait)
# ============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_KEY="${HOME}/.ssh/bb_deploy_key"
VPS_USER="root"
VPS_HOST="5.161.96.49"
IMAGE_BASE="ghcr.io/allysonfmelo/bb-api"
SERVICE_NAME="bb_api"
HEALTH_URL="https://api.biabeltrao.com.br/health"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

log()   { echo -e "${BLUE}▸${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
err()   { echo -e "${RED}✗${NC} $*" >&2; }

# --- Parse args ---------------------------------------------------------------
WAIT_FOR_CI=1
TARGET_SHA=""

for arg in "$@"; do
  case "$arg" in
    --no-wait) WAIT_FOR_CI=0 ;;
    --help|-h)
      sed -n '3,20p' "$0"
      exit 0
      ;;
    -*)
      err "Flag desconhecida: $arg"
      exit 1
      ;;
    *)
      TARGET_SHA="$arg"
      ;;
  esac
done

# --- Pre-flight checks --------------------------------------------------------
if [ ! -f "$SSH_KEY" ]; then
  err "Chave SSH não encontrada em $SSH_KEY"
  exit 1
fi

if [ -z "$TARGET_SHA" ]; then
  cd "$REPO_ROOT"
  TARGET_SHA="$(git rev-parse --short=7 HEAD)"
  log "Usando HEAD atual: ${BOLD}${TARGET_SHA}${NC}"
else
  log "SHA alvo: ${BOLD}${TARGET_SHA}${NC}"
fi

FULL_IMAGE="${IMAGE_BASE}:${TARGET_SHA}"

# --- Wait for GitHub Actions CI (optional) -----------------------------------
if [ "$WAIT_FOR_CI" = "1" ]; then
  if ! command -v gh >/dev/null 2>&1; then
    warn "gh CLI não encontrado — pulando espera do CI"
  else
    log "Aguardando workflow do GitHub Actions para ${TARGET_SHA}..."
    MAX_WAIT_SECONDS=600
    WAITED=0
    RUN_ID=""

    while [ "$WAITED" -lt "$MAX_WAIT_SECONDS" ]; do
      RUN_ID=$(gh run list --workflow=deploy.yml --limit 10 \
        --json databaseId,headSha,status,conclusion \
        --jq ".[] | select(.headSha | startswith(\"${TARGET_SHA}\")) | .databaseId" \
        | head -1)

      if [ -n "$RUN_ID" ]; then
        break
      fi
      sleep 5
      WAITED=$((WAITED + 5))
    done

    if [ -z "$RUN_ID" ]; then
      warn "Nenhum run do CI encontrado para ${TARGET_SHA} após ${MAX_WAIT_SECONDS}s"
      warn "Prosseguindo assumindo que a imagem já está no GHCR"
    else
      log "Run do CI: #${RUN_ID}"
      if ! gh run watch "$RUN_ID" --exit-status >/dev/null 2>&1; then
        err "Workflow do CI falhou — abortando deploy na VPS"
        err "Veja: gh run view ${RUN_ID} --log-failed"
        exit 1
      fi
      ok "CI concluído com sucesso"
    fi
  fi
fi

# --- Deploy to VPS ------------------------------------------------------------
log "Conectando na VPS (${VPS_USER}@${VPS_HOST})"
log "Imagem: ${BOLD}${FULL_IMAGE}${NC}"
echo

ssh -i "$SSH_KEY" -o ConnectTimeout=10 "${VPS_USER}@${VPS_HOST}" bash <<REMOTE
set -euo pipefail

echo "▸ Puxando imagem do GHCR..."
if ! docker pull "${FULL_IMAGE}" 2>&1 | tail -3; then
  echo "✗ Falha ao puxar imagem. A build do CI pode não ter terminado ainda." >&2
  exit 1
fi

echo "▸ Atualizando serviço ${SERVICE_NAME}..."
docker service update \
  --image "${FULL_IMAGE}" \
  --with-registry-auth \
  "${SERVICE_NAME}"

echo "▸ Status final:"
docker service ls --filter name=${SERVICE_NAME} --format '  {{.Name}} | {{.Replicas}} | {{.Image}}'
REMOTE

echo
log "Validando health check..."
sleep 2
if curl -sk -o /dev/null -w "%{http_code}" "$HEALTH_URL" | grep -q 200; then
  ok "Health check ${HEALTH_URL} → 200 OK"
  echo
  ok "${BOLD}Deploy concluído com sucesso${NC}"
else
  err "Health check falhou em $HEALTH_URL"
  exit 1
fi
