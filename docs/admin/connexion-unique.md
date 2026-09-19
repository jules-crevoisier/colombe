# Connexion unique (OpenID Connect)

Colombe peut déléguer l'authentification à l'annuaire fédéré de l'établissement (ENT,
Keycloak, CAS, Shibboleth, Entra ID, Google Workspace…) via **OpenID Connect** : les
utilisateurs se connectent avec leur compte d'établissement, sans ressaisir de mot de
passe propre à Colombe.

::: tip Ce que ça change pour vos utilisateurs
Voir aussi le [guide utilisateur](/guide/#se-connecter-avec-le-compte-de-letablissement) :
ce qu'ils voient à l'écran, les messages d'erreur, la déconnexion.
:::

## Testé, et pas testé

Cette fonctionnalité a été testée **de bout en bout** avec quatre bancs d'essai, chacun
dans son propre `docker-compose.*.yml` et sa propre commande `pnpm test:*`, avec de vrais
conteneurs (pas de simulation) :

- **`docker-compose.sso.yml` / `pnpm test:sso`** — **Keycloak 26.3.3** comme fournisseur
  d'identité de référence (flux code d'autorisation + PKCE), **Dovecot 2.4** pour IMAP, la
  soumission SMTP (relayée par Dovecot lui-même) et ManageSieve, jetons validés par
  introspection (RFC 7662), mécanismes SASL **XOAUTH2** et **OAUTHBEARER**, ainsi que le
  **mode utilisateur maître**.
- **`docker-compose.cas.yml` / `pnpm test:cas`** — **Apereo CAS 7.1.6** (§CAS ci-dessous)
  comme second fournisseur d'identité OIDC, choisi pour ses différences structurelles avec
  Keycloak (webflow à deux sauts, attributs personnalisés absents du jeton par défaut sans
  configuration explicite, cookie de session OAuth marqué `Secure` sans condition…), qui ont
  mis à l'épreuve — et confirmé correct — le repli UserInfo déjà présent dans `exchangeCode`.
  IMAP, soumission SMTP et ManageSieve couverts comme pour Keycloak ; le mode utilisateur
  maître n'est testé qu'avec Keycloak.
- **`docker-compose.saml.yml` / `pnpm test:saml`** — la passerelle **Keycloak SP
  SAML + OP OIDC** recommandée pour une fédération RENATER/SAML seule (§ci-dessous),
  IdP SAML `kristophjunge/test-saml-idp` (SimpleSAMLphp 1.15), Dovecot 2.4 comme au banc
  Keycloak direct.
- **`docker-compose.postfix.yml` / `pnpm test:postfix`** — soumission SMTP par connexion
  unique à travers un vrai **Postfix** (3.7.11) en frontal, pas la soumission Dovecot
  utilisée par les trois bancs précédents (§Postfix ci-dessous).

Tout le reste de cette page — Dovecot 2.3, Shibboleth, Microsoft Entra ID, Google
Workspace — est documenté de bonne foi à partir du protocole et du code de Colombe, mais
**n'a pas été vérifié contre un vrai serveur**. Chaque section non testée est marquée comme
telle : testez en pré-production avant de couper l'ancienne authentification.

## Comment Colombe accède à la messagerie après une connexion unique

Colombe ne connaît jamais le mot de passe IMAP d'un utilisateur connecté par OIDC. Deux
façons d'accéder quand même à sa boîte (`MAIL_SSO_AUTH`) :

| Mode | Principe | Accès de Colombe |
|---|---|---|
| `oauth2` (recommandé) | Le jeton d'accès OIDC obtenu à la connexion est présenté à Dovecot en SASL XOAUTH2 ou OAUTHBEARER ; Dovecot le fait valider par le fournisseur d'identité (introspection). | Uniquement la boîte de l'utilisateur connecté, pour la durée de vie du jeton. |
| `master` | Colombe s'authentifie avec un **utilisateur maître Dovecot** (`utilisateur*maître`), un compte technique qui peut ouvrir n'importe quelle boîte. | **Toutes les boîtes de l'établissement**, en permanence. |

### Choisir

Préférez `oauth2` par défaut : c'est le seul mode qui respecte le principe « Colombe
n'a accès qu'à ce que l'utilisateur autorise ». Réservez `master` aux cas où
l'introspection de jetons n'est pas réalisable côté serveur de messagerie (fournisseur
d'identité qui n'expose pas d'introspection utilisable par Dovecot, migration rapide,
tests) — et traitez-le comme vous traiteriez un compte d'administration Dovecot : accès
restreint, journalisé, changé si un incident touche le serveur Colombe.

::: danger Mode master : ce que ça signifie vraiment
`MAIL_MASTER_PASSWORD` ouvre **toutes les boîtes de l'établissement**, sans distinction
d'utilisateur. Une fuite de ce secret (compromission du serveur Colombe, fichier de
configuration mal protégé) équivaut à une fuite de tous les mots de passe de messagerie à
la fois. N'activez ce mode que si vous en comprenez la portée, avec un mot de passe généré
(`openssl rand -base64 32`, 24 caractères minimum imposés par Colombe), gardé hors du
dépôt et tourné en cas de doute.
:::

## Variables Colombe

Toutes lues au démarrage par `server/lib/config/index.ts` — voir aussi
[Configuration, §Connexion unique](/admin/configuration#connexion-unique-openid-connect)
pour leur emplacement dans la référence générale.

| Variable | Défaut | Rôle |
|---|---|---|
| `AUTH_METHODS` | `password` | Méthodes de connexion proposées, séparées par des virgules/espaces : `password`, `oidc`, ou les deux (`password,oidc` affiche le mot de passe replié derrière une divulgation, sous le bouton de connexion unique). Au moins une des deux est obligatoire. |
| `OIDC_ISSUER` | — (obligatoire avec `oidc`) | URL de l'émetteur, sans `?` ni `#` : la découverte se fait sur `<OIDC_ISSUER>/.well-known/openid-configuration`. **https obligatoire**, sauf boucle locale (`localhost`/`127.0.0.1`, tests uniquement). |
| `OIDC_CLIENT_ID` | — (obligatoire) | Identifiant du client déclaré chez le fournisseur. |
| `OIDC_CLIENT_SECRET` | — (obligatoire) | Secret du client **confidentiel** (jamais un client public : Colombe s'authentifie lui-même auprès du fournisseur). |
| `OIDC_SCOPES` | `openid email profile offline_access` | Portées demandées. `openid` est obligatoire. Voir la recommandation ci-dessous sur `offline_access`. |
| `OIDC_EMAIL_CLAIM` | `email` | Revendication (claim) du jeton d'identité (ou de UserInfo si absente du jeton) qui porte l'adresse de messagerie. Sans `@`, `MAIL_LOGIN_DEFAULT_DOMAIN` est ajouté — utile avec un claim `uid` ou `preferred_username`. |
| `OIDC_BUTTON_LABEL` | `Se connecter avec mon compte de l'établissement` | Texte du bouton sur la page de connexion. |
| `OIDC_LOGOUT` | `true` | `true` : la déconnexion Colombe redirige aussi vers `end_session_endpoint` du fournisseur (déconnexion complète). `false` : déconnexion locale seulement. |
| `OIDC_REDIRECT_URL` | déduite (`<origine><base>api/auth/oidc/callback`) | À fixer explicitement si l'origine vue par Nitro n'est pas fiable (dérivée depuis la requête, `MAIL_TRUST_PROXY` sinon). Doit se terminer par `/api/auth/oidc/callback`. |
| `MAIL_SSO_AUTH` | `oauth2` | `oauth2` ou `master`, voir ci-dessus. |
| `MAIL_OAUTH_MECHANISM` | `xoauth2` | `xoauth2` (format Google) ou `oauthbearer` (RFC 7628), mode `oauth2` uniquement. Dovecot valide les deux de façon identique ; imapflow choisit lui-même OAUTHBEARER côté IMAP si le serveur l'annonce. |
| `MAIL_MASTER_USER`, `MAIL_MASTER_PASSWORD`, `MAIL_MASTER_SEPARATOR` | — / — / `*` | Mode `master` uniquement. Séparateur = `auth_master_user_separator` de Dovecot. Mot de passe : 24 caractères minimum imposés au démarrage. |
| `COLOMBE_PORTAL_URL` | — | Lien « Retour à l'ENT » affiché sur la page de connexion et utilisé comme destination de déconnexion quand `OIDC_LOGOUT=false` (ou quand le fournisseur n'annonce pas de `end_session_endpoint`). |

::: warning `offline_access` et déconnexion côté fournisseur
`offline_access` fait durer le jeton de rafraîchissement au-delà de la session du
fournisseur d'identité (selon sa politique) : un utilisateur qui se déconnecte de son
compte d'établissement par ailleurs peut donc rester connecté à Colombe jusqu'à
expiration du jeton. Sur Keycloak, cette portée exige en plus le rôle `offline_access`,
sans quoi la demande est simplement ignorée. **Recommandation : `OIDC_SCOPES=openid email
profile`** (sans `offline_access`) si vous voulez que la déconnexion chez le fournisseur
mette fin à l'accès Colombe. La session Colombe reste alors limitée par la durée de vie du
jeton d'accès (voir §Comportement pour l'utilisateur ci-dessous) plutôt que par un jeton longue durée.
:::

## Dovecot

### Dovecot 2.4 (testé)

Depuis Dovecot 2.4, les mécanismes SASL `XOAUTH2`/`OAUTHBEARER` sont validés par un bloc
`oauth2 { }` de premier niveau — **pas** par un `passdb oauth2`, qui était la syntaxe
2.3 (voir plus bas). Extrait testé (`tests/integration/sso/dovecot-sso.conf`) :

```
# PLAIN/LOGIN restent nécessaires au mode master (et aux autres logiciels de messagerie).
auth_mechanisms = plain login xoauth2 oauthbearer

oauth2 {
  # POST du jeton sur le point d'introspection, authentifié par un client confidentiel
  # dédié à Dovecot (identifiant:secret dans l'URL = authentification HTTP Basic).
  introspection_mode = post
  introspection_url = https://<identifiant>:<secret>@idp.univ-exemple.fr/realms/univ/protocol/openid-connect/token/introspect
  # Le jeton doit appartenir à l'utilisateur annoncé dans XOAUTH2/OAUTHBEARER.
  username_attribute = email
  # Jeton révoqué, expiré ou session fournisseur fermée : introspection « active: false ».
  active_attribute = active
  active_value = true
}
```

Points d'attention :

- `introspection_url` pointe vers un **client OAuth confidentiel séparé** du client
  `OIDC_CLIENT_ID` utilisé par Colombe (voir Keycloak ci-dessous) — Dovecot s'authentifie
  lui-même auprès du fournisseur pour interroger l'introspection, il ne réutilise pas le
  jeton de l'utilisateur pour ça.
- `username_attribute = email` doit correspondre à ce que `OIDC_EMAIL_CLAIM` produit côté
  Colombe (l'adresse envoyée en SASL est celle validée par `normalizeLoginEmail`).
- Le bloc `oauth2 { }` s'applique quel que soit le protocole (IMAP, soumission SMTP,
  ManageSieve) dès lors que `auth_mechanisms` les annonce.

Pour le mode `master` (`MAIL_SSO_AUTH=master`) :

```
auth_master_user_separator = *
passdb passwd-file {
  passwd_file_path = /etc/dovecot/master-users
  master = yes
  result_success = continue   # vérifie ensuite que la boîte cible existe (passdb suivante)
}
```

`/etc/dovecot/master-users` contient une ligne `<utilisateur maître>:{PLAIN}<mot de
passe>` (ou un hachage supporté). L'identifiant IMAP envoyé par Colombe prend la forme
`<utilisateur>*<utilisateur maître>` (séparateur = `MAIL_MASTER_SEPARATOR`).

### Dovecot 2.3 (non testé — pointeur)

Dovecot 2.3 utilise une syntaxe différente, `passdb { driver = oauth2 }` avec un fichier
`oauth2.conf.ext` séparé (`introspection_url`, `tokeninfo_url` ou `local_validation_key_dict`
selon le fournisseur). **Non testé avec Colombe** : reportez-vous à la documentation
officielle de Dovecot pour votre version exacte —
[wiki2.dovecot.org, Authentication/OAuth2](https://doc.dovecot.org/configuration_manual/authentication/oauth2/)
— et validez en pré-production. Le principe côté Colombe ne change pas : c'est
uniquement la configuration Dovecot qui diffère entre 2.3 et 2.4.

## Postfix (soumission SMTP) — testé (3.7.11, Debian 12)

Colombe envoie le courrier via la soumission SMTP authentifiée (comme pour un compte par
mot de passe). Pour qu'un compte connecté en OIDC puisse envoyer, la soumission Postfix
doit accepter XOAUTH2/OAUTHBEARER et les faire valider par Dovecot — **testé de bout en
bout** (banc d'essai `docker-compose.postfix.yml`, `pnpm test:postfix`) : Postfix (3.7.11,
paquet Debian 12) en frontal de soumission (587), Dovecot 2.4 en second conteneur derrière
un socket SASL **TCP** (pas un socket Unix partagé — Postfix et Dovecot sont deux
conteneurs, deux systèmes de fichiers), jetons validés par introspection Keycloak (même
royaume que le banc Keycloak direct), messages relayés jusqu'à Mailpit.

```
# main.cf (Postfix)
smtpd_sasl_type = dovecot
smtpd_sasl_path = inet:dovecot-postfix:12345
smtpd_sasl_auth_enable = yes
smtpd_sasl_security_options = noanonymous
smtpd_relay_restrictions = permit_sasl_authenticated, reject
smtpd_recipient_restrictions = permit_sasl_authenticated, reject
```

```
# auth.conf (Dovecot 2.4) — même bloc oauth2 { } que pour IMAP, plus un service auth exposé
# en TCP puisque Postfix tourne dans un conteneur séparé (pas de socket Unix partageable
# sans complications de propriétaire/permissions entre deux images différentes) :
# https://doc.dovecot.org/main/howto/sasl/postfix.html, « TCP-based authentication ».
auth_mechanisms = plain login xoauth2 oauthbearer

oauth2 {
  introspection_mode = post
  introspection_url = http://dovecot:<secret>@keycloak:8080/realms/<royaume>/protocol/openid-connect/token/introspect
  username_attribute = email
  active_attribute = active
  active_value = true
}

service auth {
  inet_listener auth-postfix {
    port = 12345
  }
}
```

```
# master.cf (Postfix) — soumission (587), authentification obligatoire
submission inet n       -       n       -       -       smtpd
  -o syslog_name=postfix/submission
  -o smtpd_tls_security_level=encrypt
  -o smtpd_sasl_auth_enable=yes
  -o smtpd_reject_unlisted_recipient=no
  -o smtpd_relay_restrictions=permit_sasl_authenticated,reject
  -o smtpd_recipient_restrictions=permit_sasl_authenticated,reject
  -o milter_macro_daemon_name=ORIGINATING
```

Points d'attention (banc d'essai testé, `tests/integration/postfix/`) :

- **Socket TCP, pas Unix** : avec Postfix et Dovecot dans deux conteneurs différents, un
  socket Unix partagé exige un volume monté aux mêmes chemin/permissions des deux côtés, et
  les utilisateurs `postfix`/`dovecot` n'ont pas le même UID d'une image à l'autre — le
  service auth TCP de Dovecot (`inet_listener`, `smtpd_sasl_path = inet:<hôte>:<port>`)
  évite ce problème et fonctionne aussi bien pour un déploiement multi-machines.
- **`smtpd_relay_restrictions` et `smtpd_recipient_restrictions`** doivent tous les deux
  exiger `permit_sasl_authenticated` : `smtpd_relay_restrictions` seul ne suffit pas selon
  la version de Postfix et la présence de `mynetworks`.
- Debian n'exécute plus les services chrootés par défaut (`master.cf` généré avec
  `chroot = n` partout) : plus besoin de dupliquer les bibliothèques de résolution de noms
  dans le chroot, contrairement aux anciennes recettes Postfix/Dovecot.

::: warning Longueur de ligne SMTP et jetons OIDC
Un jeton d'accès OIDC encodé (JWT en base64) peut atteindre **~2 Ko**. Colombe l'envoie
volontairement **après le défi `334` du serveur** (`AUTH XOAUTH2` / `AUTH OAUTHBEARER`,
puis la réponse sur sa propre ligne), jamais en une seule ligne `AUTH <mécanisme>
<réponse>` — une réponse initiale sur la ligne `AUTH` aurait dépassé la limite de
longueur de commande de la soumission Dovecot (« 500 5.5.2 Line too long »). **Vérifié** :
un jeton d'accès Keycloak réel du banc d'essai fait environ 1,3 Ko une fois encodé, largement
sous `line_length_limit = 2048` (valeur par défaut de Postfix, testée telle quelle, sans la
modifier) — un fournisseur d'identité aux jetons particulièrement verbeux (revendications
additionnelles) peut néanmoins s'en approcher ; le test échoue explicitement si jamais un
jeton dépassait 2 Ko pour vous alerter plus tôt qu'un « 500 5.5.2 Line too long » en
production.
:::

## Par fournisseur d'identité

### Keycloak (testé)

Configuration exacte du banc d'essai (`tests/integration/sso/keycloak-realm.json`),
transposable à un royaume de production :

- **Client Colombe** (`colombe`) : confidentiel (`publicClient: false`), flux standard
  (`standardFlowEnabled: true`), **PKCE `S256`** obligatoire
  (`pkce.code.challenge.method: S256`), URI de redirection exacte
  `<origine>[<base>]api/auth/oidc/callback` (ex.
  `https://webmail.univ-exemple.fr/api/auth/oidc/callback`), URI de retour post-déconnexion
  `<origine>[<base>]login`.
- **Client Dovecot** (`dovecot`) : confidentiel, **séparé** du client Colombe, sans flux
  standard ni comptes de service — sert uniquement à authentifier les appels
  d'introspection de Dovecot (`introspection_url` avec `identifiant:secret` en HTTP Basic
  dans l'URL, ou configuré autrement selon votre version de Dovecot).
- **`KC_HOSTNAME`** : à fixer explicitement sur l'émetteur (`iss`) public et cohérent, que
  ce soit le navigateur qui joint Keycloak (`OIDC_ISSUER` de Colombe) ou Dovecot qui
  interroge l'introspection depuis le réseau interne — un `iss` qui diffère selon l'appelant
  fait échouer la validation du jeton d'identité. Le banc d'essai illustre ce cas : le
  navigateur et Colombe joignent Keycloak par `localhost:8180`, Dovecot par `keycloak:8080`
  en interne, avec `KC_HOSTNAME=http://localhost:8180` fixé pour que `iss` soit identique
  des deux côtés.
- **`offline_access`** : rôle à accorder explicitement au client ou aux utilisateurs sur
  Keycloak si vous choisissez de demander cette portée (voir l'avertissement plus haut sur
  `OIDC_SCOPES`) — sinon la portée est ignorée silencieusement par Keycloak.

### CAS 7.x (protocole OIDC) — testé

Configuration exacte du banc d'essai (`docker-compose.cas.yml`, `tests/integration/cas/`),
transposable à un déploiement CAS de production :

- **Apereo CAS 7.1.6**, construit localement depuis le gabarit officiel
  [`apereo/cas-overlay-template`](https://github.com/apereo/cas-overlay-template) (branche
  `7.1`), avec le module `cas-server-support-oidc` (et
  `cas-server-support-json-service-registry` pour déclarer les services en JSON) ajoutés à
  `build.gradle`. Le [CAS Initializr](https://github.com/apereo/cas-initializr) (public
  `getcas.apereo.org`, ou son image Docker `apereo/cas-initializr`) génère normalement ce
  même gabarit, mais s'est révélé peu fiable pour cet essai (limite de débit stricte côté
  service public ; l'image Docker autohébergée nécessite en plus une base MongoDB pour son
  propre registre interne de modules, sans quoi elle refuse tout jeton CAS demandé). Cloner
  directement le gabarit officiel — la méthode d'installation alternative que CAS documente
  lui-même — est tout aussi correct et plus simple à reproduire.
- **Client Colombe** (`colombe`, `etc/cas/services/colombe-10001.json`) : confidentiel, flux
  standard + PKCE S256, URI de redirection exacte. Trois réglages **indispensables**, sans
  quoi le flux échoue silencieusement ou reste bloqué sur le formulaire de connexion (voir
  « Pièges » ci-dessous) :
  - `"bypassApprovalPrompt": true` — sinon CAS affiche un écran de consentement OAuth
    (« Approve Access ») que ce banc ne pilote pas ;
  - `"usernameAttributeProvider"` avec `PrincipalAttributeRegisteredServiceUsernameProvider`
    sur l'attribut `mail` — sans quoi le `sub` du jeton est l'identifiant CAS nu (`dev`), pas
    l'adresse de messagerie, et Dovecot (qui compare le `sub` d'introspection à l'identité
    SASL envoyée par Colombe) refuse le jeton ;
  - `"attributeReleasePolicy"` de type `org.apereo.cas.oidc.claims.OidcScopeFreeAttributeReleasePolicy`
    (pas `ReturnAllowedAttributeReleasePolicy`, qui est le style protocole CAS classique) —
    seule cette classe **OIDC-consciente** place les attributs personnalisés (`mail`, `uid`)
    directement dans le jeton d'identité ; l'autre les relègue dans un objet `attributes`
    imbriqué côté UserInfo, invisible pour `openid-client`.
- **Client Dovecot** (`dovecot`, `etc/cas/services/dovecot-10002.json`) : confidentiel,
  **séparé** du client Colombe, sans flux standard ni grant — sert uniquement à
  authentifier les appels d'introspection.
- **Comptes statiques** (`etc/cas/config/cas.properties`) :
  `cas.authn.accept.users=dev::dev-sso-password,alice::alice-sso-password`, avec les
  attributs (`mail`, `uid`, `givenName`, `sn`) fournis par un dépôt JSON statique
  (`cas.authn.attribute-repository.json[0].location`, voir `etc/cas/config/attributes.json`)
  — `uid` porte l'identifiant nu (« dev »), `mail` l'adresse complète, pour tester les deux
  valeurs possibles d'`OIDC_EMAIL_CLAIM`.
- **`cas.server.name`** : comme `KC_HOSTNAME` pour Keycloak, à fixer explicitement
  (`http://localhost:8444` dans le banc) pour que l'émetteur (`iss`) soit identique que la
  requête vienne du navigateur/Colombe (`localhost:8444`) ou de Dovecot depuis le réseau
  interne Docker (`cas:8080`).

Extrait testé du bloc `oauth2 { }` (`tests/integration/cas/dovecot-cas.conf`) :

```
oauth2 {
  introspection_mode = post
  introspection_url = http://<identifiant>:<secret>@cas.interne:8080/cas/oidc/introspect
  username_attribute = sub
  active_attribute = active
  active_value = true
}
```

Points d'attention propres à CAS (constatés en pilotant un vrai conteneur, pas déduits du
protocole) :

- **`/oidc/introspect` ne renvoie jamais les attributs relâchés par `attributeReleasePolicy`**
  — seulement les champs RFC 7662 standard (`active`, `sub`, `scope`, `iat`, `exp`, `iss`,
  `aud`, `client_id`…). `sub` vaut par défaut l'identifiant CAS nu (« dev »), jamais
  l'adresse de messagerie que Colombe envoie en SASL — d'où le `usernameAttributeProvider`
  ci-dessus, qui fixe le `sub` du client `colombe` sur l'attribut `mail`. **Sans ce réglage,
  aucun jeton n'ouvre jamais la boîte**, quel que soit le mode d'obtention.
- **Le grant « password » (ROPC) est bien supporté** par CAS 7.1.6 (`/oidc/oidcAccessToken`,
  `grant_type=password`, activé pour le seul client `colombe` via `supportedGrantTypes`) —
  contrairement à l'hypothèse de départ qu'il faudrait s'en passer. Mais son jeton porte un
  `sub` différent de celui du flux code d'autorisation pour le **même** utilisateur : ROPC
  contourne le webflow CAS (et donc `usernameAttributeProvider`, qui s'applique à la
  résolution du principal lors de la validation de ticket) et retombe sur l'identifiant nu.
  **Un jeton ROPC est un jeton CAS valide, mais Dovecot le refuse** dans cette configuration
  — testé et documenté (`cas.dovecot.test.ts`), pas une supposition. Utilisez le flux code
  d'autorisation (le vrai formulaire de connexion) pour obtenir des jetons compatibles
  Dovecot ; ROPC reste utile pour vérifier rapidement qu'un compte/mot de passe fonctionne
  côté CAS lui-même.
- **Attributs personnalisés : dans le jeton d'identité, pas seulement UserInfo** — avec
  `OidcScopeFreeAttributeReleasePolicy`, `mail`/`uid` apparaissent directement, aplatis,
  dans les revendications du jeton d'identité (`exchangeCode` n'a donc pas besoin de son
  repli UserInfo dans cette configuration). `/oidc/oidcProfile` (UserInfo) les renvoie aussi,
  mais imbriqués sous une clé `attributes` (`{"attributes":{"mail":"…"}}`) plutôt qu'à plat
  — une réponse UserInfo non standard que `openid-client` ne sait pas lire nativement. Le
  repli UserInfo de Colombe reste donc utile pour d'autres fournisseurs (Shibboleth,
  oidc-provider…), mais ne sauverait pas une configuration CAS qui n'utiliserait que
  `ReturnAllowedAttributeReleasePolicy` (protocole CAS classique) sans le compléter par une
  classe OIDC-consciente.
- **Formulaire de connexion en deux temps** : contrairement à Keycloak, une requête non
  authentifiée vers `/oidc/oidcAuthorize` répond par une redirection **séparée** vers
  `/login?service=…` avant de servir le formulaire — un saut de plus à suivre. Le formulaire
  lui-même exige un champ caché `execution` (jeton anti-rejeu du webflow Spring), en plus de
  `username`/`password`/`_eventId=submit`.
- **Écran de consentement par défaut** (« Approve Access ») : à la différence du royaume
  Keycloak de ce banc, un `OidcRegisteredService` CAS fraîchement déclaré **exige** une
  confirmation explicite de l'utilisateur avant de délivrer un code — `bypassApprovalPrompt:
  true` la supprime pour un client interne de confiance comme Colombe (voir plus haut).
- **Cookie de réplication de session marqué `Secure` sans condition** : le flux
  code+PKCE/OAuth de CAS porte son état (entre `/oidc/oidcAuthorize` et
  `/oauth2.0/callbackAuthorize`) dans un cookie (`DISSESSIONOauthOidcServerSupport`) émis
  avec l'attribut `Secure`, quel que soit `server.ssl.enabled`. Sur ce banc, volontairement
  en http:// simple (boucle locale, comme Keycloak), ce cookie n'était donc **jamais
  renvoyé** par le client, et CAS retombait sur une redirection finale sans paramètre
  `code` — un échec silencieux, sans erreur explicite côté CAS. Réglage qui corrige ceci
  (`etc/cas/config/cas.properties`) :
  ```
  cas.authn.oauth.session-replication.cookie.secure=false
  cas.authn.oauth.session-replication.cookie.same-site-policy=lax
  ```
  En production (CAS derrière TLS, comme il se doit), ce problème ne se pose pas — mais si
  vous testez CAS en local sans certificat, c'est le premier réglage à vérifier.
- **`refresh_token` non délivré sans `offline_access`** : conforme au comportement attendu
  (voir l'avertissement plus haut sur `OIDC_SCOPES`) — CAS ne renvoie de jeton de
  rafraîchissement que si la portée `offline_access` est demandée, ce que Colombe
  déconseille par défaut. `supportedGrantTypes` du client déclare bien `refresh_token`
  (le mécanisme existe), simplement il n'est pas sollicité avec `OIDC_SCOPES=openid email
  profile`.
- **Déconnexion** : `end_session_endpoint` = `<issuer>/oidcLogout`, annoncé normalement dans
  le document de découverte. Testé jusqu'à la redirection initiée par Colombe
  (`id_token_hint` + `post_logout_redirect_uri`) ; le comportement de CAS *après* cette
  redirection (fin de session CAS, éventuel retour vers `post_logout_redirect_uri`) n'a pas
  été vérifié en détail au-delà de la présence de l'URL dans la réponse — à confirmer en
  pré-production si la déconnexion complète chez le fournisseur est requise.
- **`OIDC_EMAIL_CLAIM=mail` et `OIDC_EMAIL_CLAIM=uid` + `MAIL_LOGIN_DEFAULT_DOMAIN`
  fonctionnent tous les deux**, testés contre le même CAS (`cas.dovecot.test.ts` couvre les
  deux configurations avec deux instances Colombe distinctes) : `mail` porte l'adresse
  complète, `uid` l'identifiant nu que Colombe complète avec
  `MAIL_LOGIN_DEFAULT_DOMAIN=universite.example`.

### Shibboleth IdP 5 (greffon OIDC) — non testé

Le greffon OIDC de Shibboleth IdP 5 ajoute un comportement OpenID Connect par-dessus une
fédération SAML existante. Non testé ; mêmes remarques que pour CAS :
attributs potentiellement disponibles seulement via UserInfo (géré par Colombe),
`OIDC_EMAIL_CLAIM` à faire correspondre à l'attribut réellement publié
(`mail`, `uid` + `MAIL_LOGIN_DEFAULT_DOMAIN`…), jetons opaques → introspection Dovecot.

### Fédération RENATER / SAML seul — passerelle recommandée (testée : Keycloak 26 + SimpleSAMLphp 1.15)

Si votre fournisseur d'identité ne parle que SAML (fédération RENATER pure, sans greffon
OIDC), Colombe ne peut pas s'y connecter directement : il ne parle **que** OpenID Connect
(voir [Sécurité, §Ce que Colombe ne fait pas](/admin/securite#ce-que-colombe-ne-fait-pas-a-traiter-ailleurs)
— SAML natif reste hors périmètre). L'architecture recommandée est de placer une
**passerelle OIDC devant le SAML** :

- [SATOSA](https://github.com/IdentityPython/SATOSA) (proxy d'identité dédié, parle SAML
  côté fédération et OIDC côté Colombe) — **non testée** avec Colombe, ou
- Keycloak configuré comme **SP SAML** (côté fédération RENATER, Identity Provider =
  SAML) **et OP OIDC** (côté Colombe) — un seul Keycloak peut jouer les deux rôles.
  **Testé de bout en bout** (banc d'essai `docker-compose.saml.yml`, `pnpm test:saml`) :
  Keycloak 26.3.3 avec un IdP SAML `kristophjunge/test-saml-idp` (SimpleSAMLphp 1.15,
  comptes de test par défaut `user1`/`user1pass`, `user2`/`user2pass`) fédéré en amont,
  Dovecot 2.4 validant les jetons OIDC de Keycloak par introspection exactement comme dans
  le banc Keycloak direct, Mailpit pour la soumission SMTP.

Colombe ne voit jamais le SAML : il ne parle qu'OIDC à Keycloak, exactement comme dans le
banc Keycloak testé plus haut — le SAML n'apparaît que dans la configuration de l'Identity
Provider Keycloak et dans la page de connexion (Keycloak affiche un bouton pour l'IdP
fédéré à côté de son propre formulaire).

Configuration exacte du banc d'essai (`tests/integration/saml/keycloak-saml-realm.json`,
bloc `identityProviders`) :

```
{
  "alias": "saml-idp",
  "providerId": "saml",
  "updateProfileFirstLoginMode": "off",
  "trustEmail": true,
  "config": {
    "principalType": "ATTRIBUTE",
    "principalAttribute": "email",
    "postBindingResponse": "true",
    "postBindingAuthnRequest": "true",
    "wantAssertionsSigned": "false",
    "validateSignature": "false",
    "singleSignOnServiceUrl": "<url SSOService.php de l'IdP SAML>",
    "idpEntityId": "<url metadata.php de l'IdP SAML>"
  }
}
```

Et un mapper qui fait passer l'attribut SAML `mail`/`email` dans l'utilisateur Keycloak
(ensuite exposé à Colombe comme n'importe quel claim OIDC `email`) :

```
{
  "identityProviderAlias": "saml-idp",
  "identityProviderMapper": "saml-user-attribute-idp-mapper",
  "config": { "attribute.name": "email", "user.attribute": "email", "syncMode": "FORCE" }
}
```

Points d'attention découverts en testant (à transposer à votre IdP SAML réel — Shibboleth,
un ADFS, la fédération RENATER — dont les noms d'attributs et le NameID diffèrent de
SimpleSAMLphp) :

- **`principalType: ATTRIBUTE` plutôt que le NameID par défaut (`SUBJECT`)** : de nombreux
  IdP SAML (dont SimpleSAMLphp par défaut, et couramment Shibboleth) émettent un NameID
  **transitoire**, différent à chaque session. Keycloak lie l'identité fédérée sur ce
  NameID par défaut : avec un NameID transitoire, chaque connexion ressemblerait à un tout
  premier login, et Keycloak proposerait à répétition un écran « Un compte avec cette
  adresse existe déjà, comment continuer ? » au lieu de reconnaître l'utilisateur. Fixer
  `principalType=ATTRIBUTE` avec `principalAttribute` sur un attribut **stable** (l'adresse
  de messagerie, ou `eduPersonPrincipalName` en fédération RENATER/Shibboleth) résout ça.
- **Premier login = écran « Update Account Information »** : même avec
  `updateProfileFirstLoginMode: off`, le tout premier login d'un compte fédéré passe par un
  écran de complétion de profil (nom d'utilisateur, prénom, nom — l'e-mail vient de l'IdP)
  avant de créer le compte Keycloak ; les connexions suivantes du même compte l'évitent
  (identité déjà liée). C'est un comportement Keycloak normal à prévoir dans le mode
  opératoire des utilisateurs, pas un dysfonctionnement.
- **Longueur du nom d'utilisateur** : si vous dérivez le nom d'utilisateur Keycloak d'un
  attribut SAML court (ex. un `uid` numérique comme dans SimpleSAMLphp), Keycloak exige au
  moins 3 caractères — préfixez le gabarit du mapper (`saml-username-idp-mapper`,
  `template`) plutôt que d'utiliser l'attribut brut.
- **`validateSignature: false`** dans ce banc (comme `sslRequired: none` du royaume
  Keycloak testé plus haut) : acceptable en test local, à revoir en production selon que
  votre IdP SAML publie des métadonnées signées vérifiables.
- **Non testé** : déconnexion SAML (Single Logout) à travers la passerelle — ce banc ne
  vérifie que la connexion ; `OIDC_LOGOUT` continue de rediriger vers Keycloak comme dans
  le banc direct, mais Keycloak ne relaie pas nécessairement la déconnexion jusqu'à l'IdP
  SAML sans configuration SLO supplémentaire.

### Microsoft Entra ID — non testé

- La revendication `email` d'Entra ID n'est pas toujours fiable ou présente (comptes
  invités, tenants sans licence E5…) : préférez `preferred_username` ou `upn` comme
  `OIDC_EMAIL_CLAIM` selon ce que retourne votre tenant, en testant au préalable ce qui
  est réellement publié.
- Le jeton d'accès émis par Entra ID cible en général Microsoft Graph, pas Dovecot :
  l'introspection RFC 7662 classique ne s'applique pas directement. Validez plutôt via un
  appel à `https://graph.microsoft.com/v1.0/me` avec le jeton reçu (`introspection_mode =
  auth` côté Dovecot 2.4 plutôt que `post`, `username_attribute = mail`) — cela demande
  vraisemblablement la portée Graph `User.Read` en plus de `openid email profile` dans
  `OIDC_SCOPES`. Non vérifié en pratique.
- Le **mode `master`** (§Comment Colombe accède à la messagerie) est le repli le plus
  simple si l'intégration `oauth2` avec Entra s'avère trop spécifique à votre tenant.

### Google Workspace — non testé

Similaire à Entra ID : le jeton d'accès cible les API Google, pas Dovecot. Dovecot documente
une recette `tokeninfo_url` (`https://oauth2.googleapis.com/tokeninfo`) pour ce cas — non
testée avec Colombe. Comme pour Entra ID, le mode `master` reste le repli le plus simple si
cette intégration se révèle trop spécifique.

## Comportement pour l'utilisateur

- **Connexion** : bouton unique (`OIDC_BUTTON_LABEL`) qui redirige vers le fournisseur ;
  le mot de passe Colombe, si `AUTH_METHODS` propose aussi `password`, reste accessible
  derrière une divulgation discrète (« Se connecter avec un mot de passe »).
- **Double authentification Colombe** : si l'utilisateur l'a activée dans ses paramètres,
  elle s'applique **en plus** de la connexion unique (un second facteur propre à Colombe,
  indépendant du fournisseur d'identité).
- **Rafraîchissement du jeton** : à chaque accès à la messagerie (lecture, envoi, filtres),
  Colombe rafraîchit le jeton d'accès s'il expire dans moins d'une minute, avec le jeton de
  rafraîchissement gardé en mémoire serveur. Une session **inactive** peut donc expirer
  selon la durée de vie du jeton de rafraîchissement côté fournisseur (`ssoSessionIdleTimeout`
  sur Keycloak, par exemple) : l'utilisateur est alors renvoyé à la page de connexion à sa
  prochaine action.
- **Confirmation d'une action sensible** (création/modification d'un transfert ou d'une
  redirection) : pour une session ouverte par connexion unique, Colombe n'a pas de mot de
  passe à vérifier — la confirmation passe par une **réauthentification chez le
  fournisseur** (`prompt=login`, `max_age=0`), avec retour sur la page d'origine dans une
  fenêtre de **5 minutes**. Voir `app/components/filters/ConfirmIdentityDialog.vue`.
- **Déconnexion** : `OIDC_LOGOUT=true` (par défaut) redirige aussi vers le fournisseur
  d'identité (`end_session_endpoint`), qui revient ensuite sur la page de connexion de
  Colombe. Sinon (ou si le fournisseur n'annonce pas cet endpoint), Colombe redirige vers
  `COLOMBE_PORTAL_URL` s'il est configuré.
- **« Retour à l'ENT »** : lien affiché sur la page de connexion quand `COLOMBE_PORTAL_URL`
  est défini, qu'OIDC soit activé ou non.
- **Journal des échecs (fail2ban)** : chaque échec de connexion unique écrit la même ligne
  que pour une connexion par mot de passe — `auth-failure ip=<ip> user=<adresse ou ->` — et
  compte dans les mêmes limites de tentatives par IP. `user=-` quand l'échec survient avant
  qu'une adresse ait pu être déterminée (réponse invalide du fournisseur, par exemple).
  Aucune modification nécessaire à une règle fail2ban déjà en place pour Colombe.
- **`returnTo`** : après la connexion unique, Colombe ramène l'utilisateur sur la page
  qu'il visitait. Ce paramètre est validé côté serveur (chemin relatif de l'application
  uniquement, jamais une URL absolue ni une route `/api/*`) : une redirection ouverte n'est
  pas possible même si le paramètre est manipulé.

## Vérification

Avant d'ouvrir la connexion unique à tous les utilisateurs :

1. `node scripts/colombe-doctor.mjs` ne signale aucun problème de configuration.
2. La page de connexion affiche le bouton de connexion unique avec le bon libellé.
3. Une connexion complète aboutit sur `/mail/INBOX` avec le courrier de l'utilisateur
   visible (IMAP validé par le jeton ou le mode master).
4. L'envoi d'un message fonctionne (soumission SMTP — voir §Postfix ci-dessus si Postfix
   est en frontal plutôt que la soumission Dovecot).
5. Les filtres (ManageSieve) se chargent sous **Paramètres → Filtres**.
6. La déconnexion ramène bien vers le fournisseur d'identité (si `OIDC_LOGOUT=true`) ou
   vers `COLOMBE_PORTAL_URL`, sans laisser de session ouverte côté Colombe.
7. Créer ou modifier une règle de transfert déclenche la boîte de confirmation, et la
   réauthentification (mode connexion unique) aboutit bien au retour sur la page d'origine.
8. Un jeton expiré (session fournisseur fermée entre-temps) renvoie proprement
   l'utilisateur à la page de connexion plutôt que de rester bloqué.
9. Si `AUTH_METHODS=password,oidc` : la connexion par mot de passe (repliée) fonctionne
   toujours, pour les comptes qui n'existent pas côté fournisseur d'identité.
10. La ligne `auth-failure` apparaît dans les journaux lors d'un essai volontairement
    raté, avec le format attendu par votre configuration fail2ban existante.

## Dépannage

Codes affichés sur `/login?error=<code>` (message en français à l'écran ; le détail
technique, lui, ne part jamais vers le navigateur — il est dans les journaux serveur,
préfixés `[colombe]`) :

| Code | Message affiché | Cause côté serveur |
|---|---|---|
| `expired` | La connexion a expiré. Recommencez. | Le cookie d'état de la connexion (`wm_oidc`, 10 minutes, usage unique) est absent, expiré ou illisible — retour au fournisseur trop tardif, ou navigation dans plusieurs onglets. |
| `cancelled` | Connexion annulée. | L'utilisateur a annulé côté fournisseur (`error=access_denied`). |
| `idp` | Le service d'authentification de l'établissement a refusé la connexion. | Le fournisseur renvoie un autre code d'erreur OAuth (`login_required`, `invalid_scope`…) : voir le journal serveur pour le détail. |
| `invalid` | La réponse du service d'authentification est invalide. Recommencez. | `state`/`nonce`/PKCE/signature du jeton d'identité refusés par `openid-client` — souvent un `OIDC_ISSUER` ou `KC_HOSTNAME` incohérent entre ce que voit le navigateur et ce que voit Colombe. |
| `claim` | Votre compte ne fournit pas d'adresse de messagerie. Contactez le support. | La revendication `OIDC_EMAIL_CLAIM` est absente (même après UserInfo), vide, ou explicitement marquée `email_verified: false`. |
| `domain` | Ce compte n'a pas d'adresse de messagerie acceptée ici. | L'adresse obtenue (ou complétée avec `MAIL_LOGIN_DEFAULT_DOMAIN`) n'appartient à aucun domaine de `MAIL_DOMAINS`. |
| `mailbox` | Votre boîte aux lettres n'est pas accessible avec ce compte. Contactez le support. | Dovecot a refusé le jeton (introspection en échec, `active: false`) ou la boîte cible n'existe pas (mode master). Vérifiez `oauth2 { }` côté Dovecot, ou l'utilisateur maître. |
| `unavailable` | Service d'authentification ou de messagerie indisponible. Réessayez plus tard. | Le fournisseur d'identité (découverte, échange de code) ou le serveur de messagerie est injoignable — panne réseau ou service arrêté, pas un problème d'identifiants. |
| `rate` | Trop de tentatives. Réessayez dans quelques minutes. | Limite de tentatives par IP atteinte (mêmes compteurs que la connexion par mot de passe). |

Autres cas fréquents :

- **`redirect_uri` refusée par le fournisseur** : elle doit correspondre **exactement** à
  `<origine><base>api/auth/oidc/callback` (ou à `OIDC_REDIRECT_URL` si fixée), y compris le
  préfixe de déploiement (`NUXT_APP_BASE_URL`). Une différence de barre oblique finale ou
  de casse suffit à faire échouer la comparaison côté la plupart des fournisseurs.
- **`iss` incohérent** : si Colombe et Dovecot joignent le fournisseur par des noms
  d'hôte différents (réseau interne vs. public), assurez-vous que l'émetteur annoncé
  (`iss`) est identique des deux côtés — voir `KC_HOSTNAME` pour Keycloak.
- **Boucle de connexion après une réauthentification (transfert/redirection)** : la
  fenêtre de confirmation est de 5 minutes après le retour du fournisseur ; au-delà,
  Colombe redemande une confirmation plutôt que d'accepter une identification trop
  ancienne (protection contre le rejeu).
