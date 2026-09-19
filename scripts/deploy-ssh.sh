#!/usr/bin/env bash
# Déploiement par SSH d'une installation « archive + systemd » (docs/admin/installation.md).
# Build propre (aucune valeur du .env de développement), vérification des secrets, envoi,
# bascule en gardant la version précédente, contrôles.
#
# Usage :
#   DEPLOY_HOST=mail.univ-exemple.fr DEPLOY_BASE_URL=/colombe/ bash scripts/deploy-ssh.sh
#
# Variables :
#   DEPLOY_HOST      (obligatoire) hôte SSH (alias de ~/.ssh/config accepté) ; l'utilisateur
#                    doit avoir sudo sans mot de passe.
#   DEPLOY_BASE_URL  chemin de publication (défaut /) ; sert au contrôle final.
#   DEPLOY_DIR       dossier de l'application (défaut /opt/colombe).
#   DEPLOY_SERVICE   service systemd (défaut colombe).
#   DEPLOY_LOCAL_URL URL locale sur le serveur (défaut http://127.0.0.1:3100).
#   DEPLOY_PUBLIC_URL URL publique à contrôler après la bascule (facultatif).
#   SKIP_BUILD=1     réutiliser le dernier build (.deploy/colombe).
set -euo pipefail
cd "$(dirname "$0")/.."
# Git Bash (Windows) convertit « /colombe/ » en chemin Windows dans les variables
# d'environnement passées aux programmes : on désactive cette conversion.
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'

: "${DEPLOY_HOST:?DEPLOY_HOST est obligatoire (ex. DEPLOY_HOST=mail.univ-exemple.fr)}"
BASE="${DEPLOY_BASE_URL:-/}"
DIR="${DEPLOY_DIR:-/opt/colombe}"
SERVICE="${DEPLOY_SERVICE:-colombe}"
LOCAL_URL="${DEPLOY_LOCAL_URL:-http://127.0.0.1:3100}"

# La configuration est lue au démarrage sur le serveur : le build n'en contient aucune.
export NODE_ENV=production
unset NUXT_SESSION_PASSWORD WEBMAIL_DATA_KEY WEBMAIL_DATA_DIR NUXT_APP_BASE_URL 2>/dev/null || true

mkdir -p .deploy && : > .deploy/.empty.env
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  pnpm exec node scripts/with-build-lock.mjs "nuxt build --dotenv .deploy/.empty.env && node -e \"require('fs').rmSync('.deploy/colombe',{recursive:true,force:true});require('fs').cpSync('.output','.deploy/colombe',{recursive:true})\""
fi
node scripts/check-deploy-secrets.mjs

tar -czf .deploy/colombe.tgz -C .deploy/colombe .
scp -q -o BatchMode=yes .deploy/colombe.tgz "$DEPLOY_HOST:/tmp/colombe.tgz"
ssh -o BatchMode=yes "$DEPLOY_HOST" "set -e
  sudo rm -rf $DIR.new && sudo mkdir -p $DIR.new
  sudo tar -xzf /tmp/colombe.tgz -C $DIR.new && rm /tmp/colombe.tgz
  sudo chown -R root:root $DIR.new && sudo chmod -R go-w $DIR.new
  sudo rm -rf $DIR.prev && sudo mv $DIR $DIR.prev
  sudo mv $DIR.new $DIR
  sudo systemctl restart $SERVICE; sleep 4
  systemctl is-active $SERVICE
  curl -s -o /dev/null -w 'local: %{http_code}\n' $LOCAL_URL${BASE}api/health"
if [ -n "${DEPLOY_PUBLIC_URL:-}" ]; then
  curl -s -w "\npublic: %{http_code}\n" "${DEPLOY_PUBLIC_URL%/}/api/health"
fi
echo "Retour arrière : ssh $DEPLOY_HOST 'sudo rm -rf $DIR && sudo mv $DIR.prev $DIR && sudo systemctl restart $SERVICE'"
