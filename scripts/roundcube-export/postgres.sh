#!/usr/bin/env bash
# Exporte les tables Roundcube (PostgreSQL) en fichiers .tsv, un par table, lisibles par
# scripts/import-roundcube.mjs. Voir scripts/roundcube-export.sql pour le détail des
# requêtes. Utilise \copy (méta-commande psql, exécutée côté client : pas besoin de
# droits fichier côté serveur).
#
# Usage :
#   ./postgres.sh <hôte> <utilisateur> <base> <dossier_sortie> [port]
#
# Mot de passe : via ~/.pgpass, ou la variable d'environnement PGPASSWORD.
set -euo pipefail

HOST="${1:?usage: postgres.sh <hôte> <utilisateur> <base> <dossier_sortie> [port]}"
DBUSER="${2:?utilisateur PostgreSQL requis}"
DB="${3:?base Roundcube requise}"
OUT="${4:?dossier de sortie requis}"
PORT="${5:-5432}"

mkdir -p "$OUT"

PSQL_ARGS=(-h "$HOST" -p "$PORT" -U "$DBUSER" -d "$DB" -v ON_ERROR_STOP=1 -q)

copy() {
  local name="$1" sql="$2"
  psql "${PSQL_ARGS[@]}" -c "\\copy ($sql) TO '$OUT/$name.tsv' WITH (FORMAT text)"
  echo "  $name.tsv"
}

table_exists() {
  local name="$1"
  local result
  result="$(psql "${PSQL_ARGS[@]}" -tAc "SELECT to_regclass('public.$name') IS NOT NULL")"
  [ "$result" = "t" ]
}

echo "Export Roundcube (PostgreSQL) : $HOST/$DB -> $OUT"

copy users "SELECT user_id, username, mail_host FROM users"
copy contacts "SELECT contact_id, user_id, name, email, firstname, surname, vcard, del FROM contacts"
copy contactgroups "SELECT contactgroup_id, user_id, name, del FROM contactgroups"
copy contactgroupmembers "SELECT contactgroup_id, contact_id FROM contactgroupmembers"
copy identities "SELECT identity_id, user_id, standard, name, organization, email, \"reply-to\" AS reply_to, bcc, signature, html_signature, del FROM identities"

if table_exists responses; then
  copy responses "SELECT response_id, user_id, name, data, is_html, del FROM responses"
else
  echo "  responses : table absente (Roundcube < 1.5) — réponses types non exportées"
  echo "              (elles sont peut-être sérialisées dans users.preferences ; import-roundcube.mjs le signalera)"
fi

echo ""
echo "Terminé. Lancer ensuite :"
echo "  node scripts/import-roundcube.mjs --from $OUT --domain <votre-domaine>"
