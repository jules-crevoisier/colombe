# Annuaire LDAP de l'établissement

Colombe peut interroger l'annuaire LDAP de l'établissement (schéma SupAnn/eduPerson
par-dessus `inetOrgPerson`, comme le carnet d'adresses LDAP de Roundcube) pour proposer
les personnes de l'établissement dans le champ destinataires et dans un onglet dédié de
Contacts — **recherche seule, jamais d'authentification** : Colombe ne se sert jamais de
l'annuaire pour vérifier un mot de passe, uniquement pour retrouver un nom, une adresse ou
un service.

::: tip Indépendant de la connexion unique
L'annuaire LDAP et la [connexion unique OpenID Connect](/admin/connexion-unique) sont deux
fonctionnalités séparées, activables l'une sans l'autre. Rien n'empêche de publier
l'annuaire d'un établissement qui reste par ailleurs authentifié par mot de passe.
:::

## Activation

Désactivé par défaut ; activé dès que `LDAP_URL` est défini. Voir la référence complète
des variables dans [Configuration, §Annuaire de l'établissement
(LDAP)](/admin/configuration#annuaire-de-letablissement-ldap) — cette page-ci détaille le
choix des attributs et les points d'attention propres à un annuaire SupAnn.

```ini
LDAP_URL=ldaps://annuaire.univ-exemple.fr:636
LDAP_BASE_DN=dc=univ-exemple,dc=fr
LDAP_BIND_DN=cn=colombe,ou=applications,dc=univ-exemple,dc=fr
LDAP_BIND_PASSWORD=<mot de passe du compte de service>
```

## Compte de liaison : lecture seule

Utilisez un **compte de service dédié**, en lecture seule sur l'annuaire — jamais un
compte administrateur ni le compte d'un agent. Colombe n'écrit jamais dans l'annuaire ;
un compte trop privilégié n'apporte rien et élargit inutilement ce qu'une fuite du secret
`LDAP_BIND_PASSWORD` exposerait. La liaison anonyme reste prise en charge
(`LDAP_BIND_DN`/`LDAP_BIND_PASSWORD` tous les deux absents) si votre annuaire l'autorise,
mais la plupart des annuaires d'établissement (dont un OpenLDAP avec les ACL par défaut de
l'image `osixia/openldap`) la refusent — un compte de service est alors nécessaire.

## Chiffrement : TLS obligatoire vers un hôte distant

`ldap://` en clair n'est accepté par Colombe que vers un **hôte local**
(`localhost`/`127.0.0.1`, développement uniquement). Vers un hôte distant, Colombe refuse
de démarrer sans l'un des deux :

- `ldaps://` (TLS implicite, port 636 en général) — recommandé ;
- `ldap://` + `LDAP_STARTTLS=true` (StartTLS, RFC 4513).

Sans l'un des deux, le mot de passe du compte de liaison (`LDAP_BIND_PASSWORD`)
circulerait en clair sur le réseau à chaque recherche. Le certificat du serveur LDAP est
toujours vérifié (jamais désactivable, contrairement à `MAIL_TLS_REJECT_UNAUTHORIZED` côté
messagerie).

## Attributs SupAnn : ce qui vaut la peine d'être ajusté

Les valeurs par défaut visent un annuaire `inetOrgPerson` générique. Sur un annuaire
conforme au schéma **SupAnn**, deux ajustements sont généralement pertinents :

**Service ou composante (`LDAP_ATTR_DEPARTMENT`)** — l'attribut par défaut `ou` reste un
attribut `inetOrgPerson` standard, mais un établissement SupAnn publie en général une
information plus précise dans `supannEntiteAffectation` :

```ini
LDAP_ATTR_DEPARTMENT=supannEntiteAffectation
```

Ce code est affiché **tel quel** (Colombe ne traduit aucun code d'entité) : vérifiez que
la valeur publiée par votre annuaire est déjà lisible pour un utilisateur (libellé plutôt
que code interne opaque) avant de basculer dessus — sinon `ou` reste souvent plus lisible
malgré son imprécision.

**Statut affiché (`LDAP_ATTR_AFFILIATION`)** — l'attribut eduPerson
`eduPersonPrimaryAffiliation`, déjà pris par défaut, est traduit automatiquement par
Colombe :

| Valeur brute | Affiché |
|---|---|
| `student` | Étudiant |
| `staff` | Personnel |
| `faculty` | Enseignant |
| `employee` | Personnel |
| autre valeur | affichée telle quelle, sans traduction |

Si votre annuaire ne publie pas le schéma eduPerson (fréquent sur un OpenLDAP minimal sans
les schémas eduPerson/SupAnn chargés), le champ affiliation reste simplement absent des
fiches — le reste de l'annuaire (nom, adresse, téléphone, service) continue de fonctionner
normalement.

## Masquer une catégorie de personnes

`LDAP_HIDE_AFFILIATIONS` exclut des résultats les fiches dont l'affiliation brute (avant
traduction) correspond à l'une des valeurs listées — utile par exemple pour un annuaire
webmail réservé au personnel :

```ini
LDAP_HIDE_AFFILIATIONS=student
```

## Sécurité : ce que Colombe garantit côté recherche annuaire

- **Filtre LDAP protégé contre l'injection** : chaque mot de la requête tapée par un
  utilisateur est échappé selon la RFC 4515 (`\`, `*`, `(`, `)` et l'octet NUL) avant
  d'être inséré dans le filtre — une recherche comme `*)(uid=*` ne peut ni élargir ni
  détourner le filtre envoyé au serveur.
- **Filtrage par domaine** : seules les fiches dont l'adresse appartient à `MAIL_DOMAINS`
  sont renvoyées à l'utilisateur, même si l'annuaire LDAP contient d'autres organisations
  ou un partenaire externe fiché par erreur — c'est le dernier filet appliqué juste avant
  la réponse HTTP, indépendamment du filtre LDAP lui-même.
- **Limite de débit** : 30 requêtes par minute et par session (indépendante des limites de
  connexion). Une recherche trop courte (`LDAP_MIN_QUERY`, 3 caractères par défaut) est
  refusée avant même de contacter l'annuaire.
- **Mise en cache courte** : les résultats d'une même requête sont gardés 60 secondes en
  mémoire (déjà filtrés par domaine, rien de secret) pour ne pas déclencher une recherche
  LDAP à chaque frappe pendant l'autocomplétion.
- **Reconnexion automatique** : une recherche qui échoue à cause d'une connexion LDAP
  périmée (redémarrage du serveur annuaire, coupure réseau) déclenche une seule tentative
  de reconnexion avant d'abandonner ; l'utilisateur voit alors « Annuaire momentanément
  indisponible ».

## Ce que voient les utilisateurs

- Dans le champ **À** (et Cc/Cci) d'un nouveau message, les suggestions issues de
  l'annuaire portent un badge **Annuaire**, à côté des contacts personnels.
- Dans **Paramètres → Contacts**, un onglet **Annuaire de l'établissement** permet de
  chercher (nom, prénom, adresse, à partir de 3 caractères) et d'ajouter directement une
  personne à ses contacts personnels.
- L'onglet n'apparaît que si `LDAP_URL` est configuré : sans lui, la route de recherche
  répond 404 plutôt que de laisser deviner la fonctionnalité par une réponse vide.

Voir aussi le [guide utilisateur, §Annuaire](/guide/contacts#annuaire-de-letablissement).
