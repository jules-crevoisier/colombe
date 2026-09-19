#!/usr/bin/env bash
# Exporte les tables Roundcube (MySQL/MariaDB) en fichiers .tsv, un par table, lisibles
# par scripts/import-roundcube.mjs. Voir scripts/roundcube-export.sql pour le détail des
# requêtes.
#
# Usage :
#   ./mysql.sh <hôte> <utilisateur> <base> <dossier_sortie> [port]
#
# Mot de passe : via ~/.my.cnf, ou la variable d'environnement MYSQL_PWD, ou
# --password interactif (non géré ici, exportez MYSQL_PWD ou utilisez ~/.my.cnf).
set -euo pipefail

HOST="${1:?usage: mysql.sh <hôte> <utilisateur> <base> <dossier_sortie> [port]}"
DBUSER="${2:?utilisateur MySQL requis}"
DB="${3:?base Roundcube requise}"
OUT="${4:?dossier de sortie requis}"
PORT="${5:-3306}"

mkdir -p "$OUT"

MYSQL_ARGS=(--batch --skip-column-names -h "$HOST" -P "$PORT" -u "$DBUSER" "$DB")

run() {
  local name="$1" sql="$2"
  mysql "${MYSQL_ARGS[@]}" -e "$sql" > "$OUT/$name.tsv"
  echo "  $name.tsv ($(wc -l < "$OUT/$name.tsv" | tr -d ' ') ligne(s))"
}

table_exists() {
  local name="$1"
  mysql "${MYSQL_ARGS[@]}" -e "SELECT 1 FROM $name LIMIT 1" > /dev/null 2>&1
}

echo "Export Roundcube (MySQL/MariaDB) : $HOST/$DB -> $OUT"

run users "SELECT user_id, username, mail_host FROM users"
run contacts "SELECT contact_id, user_id, name, email, firstname, surname, vcard, del FROM contacts"
run contactgroups "SELECT contactgroup_id, user_id, name, del FROM contactgroups"
run contactgroupmembers "SELECT contactgroup_id, contact_id FROM contactgroupmembers"
run identities "SELECT identity_id, user_id, standard, name, organization, email, \`reply-to\`, bcc, signature, html_signature, del FROM identities"

if table_exists responses; then
  run responses "SELECT response_id, user_id, name, data, is_html, del FROM responses"
else
  echo "  responses : table absente (Roundcube < 1.5) — réponses types non exportées"
  echo "              (elles sont peut-être sérialisées dans users.preferences ; import-roundcube.mjs le signalera)"
fi

echo ""
echo "Terminé. Lancer ensuite :"
echo "  node scripts/import-roundcube.mjs --from $OUT --domain <votre-domaine>"
