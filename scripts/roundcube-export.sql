-- Référence des requêtes utilisées pour exporter les données Roundcube vers Colombe.
--
-- Ce fichier est DOCUMENTAIRE : il n'est pas exécuté tel quel. Les scripts qui
-- s'exécutent réellement sont :
--   scripts/roundcube-export/mysql.sh     (MySQL/MariaDB — mysql --batch --skip-column-names)
--   scripts/roundcube-export/postgres.sh  (PostgreSQL — psql \copy ... TO ... WITH (FORMAT text))
--
-- Les deux produisent un fichier .tsv par table, avec le même échappement
-- (\N pour NULL, \\ \t \n \r échappés), lu par scripts/import-roundcube.mjs.
-- MySQL utilise l'identifiant entre guillemets obliques (`reply-to`), PostgreSQL entre
-- guillemets doubles ("reply-to") : les requêtes ci-dessous utilisent le style ANSI
-- (guillemets doubles) ; voir les .sh pour la version exacte envoyée à chaque moteur.
--
-- del=1 (colonne "corbeille" Roundcube) : ces lignes sont exportées mais
-- import-roundcube.mjs les ignore.

-- === users ===
-- user_id sert de clé étrangère à toutes les autres tables ; username (+ --domain si besoin)
-- donne l'adresse e-mail = owner dans la base Colombe.
SELECT user_id, username, mail_host FROM users;

-- === contacts ===
-- vcard (RFC 2426) est préféré s'il est présent et exploitable ; sinon repli sur
-- name/email/firstname/surname.
SELECT contact_id, user_id, name, email, firstname, surname, vcard, del FROM contacts;

-- === contactgroups ===
SELECT contactgroup_id, user_id, name, del FROM contactgroups;

-- === contactgroupmembers ===
SELECT contactgroup_id, contact_id FROM contactgroupmembers;

-- === identities ===
-- "reply-to" nécessite d'être quotée (contient un tiret). Colombe n'a pas de champ
-- e-mail par identité (toujours l'adresse de connexion) : si `email` diffère du
-- compte, import-roundcube.mjs le reprend comme "reply-to" par défaut — voir le
-- rapport de l'agent pour le détail de cette limitation.
SELECT identity_id, user_id, standard, name, organization, email, "reply-to", bcc, signature, html_signature, del
FROM identities;

-- === responses (Roundcube >= 1.5) ===
-- Absente sur les installations plus anciennes : les réponses types y sont sérialisées
-- dans users.preferences (PHP serialize). import-roundcube.mjs détecte ce cas et
-- avertit ; il ne désérialise pas le PHP (hors périmètre).
SELECT response_id, user_id, name, data, is_html, del FROM responses;
