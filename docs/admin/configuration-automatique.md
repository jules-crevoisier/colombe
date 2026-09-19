# Configuration automatique des logiciels de messagerie

Permet à Thunderbird et Outlook de trouver seuls les réglages IMAP/SMTP quand un
utilisateur saisit son adresse, sans recopier les valeurs à la main. Facultatif : sans
cela, les utilisateurs saisissent les valeurs manuellement depuis
**Paramètres → Autres applications** (voir [le guide utilisateur](/guide/autres-applications)).

## Ce que Colombe sert déjà

Colombe expose lui-même ces deux routes, sous son chemin de base, sans configuration
supplémentaire côté Colombe :

- `GET /mail/config-v1.1.xml` (et `/.well-known/autoconfig/mail/config-v1.1.xml`) —
  autoconfiguration Thunderbird.
- `GET|POST /autodiscover/autodiscover.xml` (et `/Autodiscover/Autodiscover.xml`,
  reconnue sans tenir compte de la casse) — autodiscover Outlook.

Les deux répondent avec les valeurs de `MAIL_PUBLIC_*` (voir
[Configuration, §Paramètres publics](/admin/configuration#parametres-publics-autres-logiciels)) :
si aucun hôte public n'est connu, elles répondent 404 plutôt que d'annoncer un serveur
interne (`localhost`) injoignable depuis l'extérieur.

Ce qui manque : que ces routes soient **atteignables aux noms que Thunderbird et Outlook
interrogent automatiquement** (`autoconfig.<domaine>`, `autodiscover.<domaine>`), ce que
Colombe seul ne peut pas fournir (DNS, certificat).

## 1. DNS

Pour chaque domaine de `MAIL_DOMAINS`, deux enregistrements pointant vers votre serveur
web (A/AAAA, ou CNAME) :

```
autoconfig.univ-exemple.fr
autodiscover.univ-exemple.fr
```

## 2. Certificat

Un certificat TLS couvrant ces deux noms — Outlook exige HTTPS pour autodiscover. Il peut
réutiliser celui du vhost principal (certificat multi-domaines) ou être un certificat
Let's Encrypt dédié à ces deux noms seulement.

## 3. Virtual host dédié

Ces deux noms pointent vers des chemins fixes (`/mail/config-v1.1.xml`,
`/autodiscover/autodiscover.xml`), sans le préfixe éventuel de `NUXT_APP_BASE_URL` : il
leur faut un virtual host séparé du vhost principal de Colombe, qui reproxie vers le
chemin réel.

- Apache : `deploy/apache/autoconfig.conf`
  ```bash
  cp deploy/apache/autoconfig.conf /etc/apache2/sites-available/colombe-autoconfig.conf
  a2ensite colombe-autoconfig && apache2ctl configtest && systemctl reload apache2
  ```
- Nginx : `deploy/nginx/autoconfig.conf`
  ```bash
  cp deploy/nginx/autoconfig.conf /etc/nginx/conf.d/colombe-autoconfig.conf
  nginx -t && systemctl reload nginx
  ```

Les deux fichiers contiennent `<domain>` à remplacer par votre domaine, et supposent
Colombe joignable en local sur `127.0.0.1:3100` (archive) — adaptez le port si vous
utilisez Docker (`127.0.0.1:3000` par défaut).

## 4. `MAIL_PUBLIC_HOST`

Si Colombe se connecte à son serveur de messagerie via `localhost` ou une IP interne,
renseignez `MAIL_PUBLIC_HOST` (et éventuellement `MAIL_PUBLIC_IMAP_HOST` /
`MAIL_PUBLIC_SMTP_HOST` si différents) avec le nom que les utilisateurs doivent
configurer. Sans cela, l'autoconfiguration et l'onglet **Autres applications** ne peuvent
pas proposer d'adresse joignable depuis l'extérieur.

## Test

```bash
curl https://autoconfig.univ-exemple.fr/mail/config-v1.1.xml
```

Doit renvoyer un document XML avec les hôtes et ports IMAP/SMTP publics.

## iPhone et iPad

Ce mécanisme ne les concerne pas : iOS n'utilise ni autoconfig ni autodiscover. Les
utilisateurs téléchargent un profil de configuration (`.mobileconfig`) directement depuis
**Paramètres → Autres applications** dans Colombe — rien à configurer côté serveur pour
cette partie.
