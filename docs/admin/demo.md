# Faire une démonstration publique

Le **mode démonstration** permet de faire essayer Colombe à des visiteurs, sans compte
existant et sans toucher à un vrai serveur de messagerie : chacun obtient une boîte
temporaire, isolée, avec des messages d'exemple.

## Comment ça se comporte pour un visiteur

Un bouton **Essayer la démo** crée à la volée un compte temporaire
(`visiteur-xxxxxxxx@universite.example`) rempli de messages d'exemple. Ce compte est
automatiquement supprimé à l'expiration de sa durée de vie. La connexion par mot de passe
est désactivée (elle répond 403) : impossible de se connecter à autre chose qu'un compte
de démonstration fraîchement créé. Aucune donnée saisie par un visiteur ne quitte jamais
le serveur — tout est en mémoire, rien n'est journalisé ni transmis ailleurs.

## Configuration

Le mode démonstration s'active par variables d'environnement (voir aussi
[Configuration, §Mode démonstration](/admin/configuration#mode-demonstration)) :

| Variable | Défaut | Rôle |
|---|---|---|
| `COLOMBE_DEMO` | `false` | Active le mode démonstration. Exige `MAIL_BACKEND=mock`. Autorisé en production **sans** `WEBMAIL_ALLOW_MOCK` (le mode démonstration est un usage prévu, contrairement au backend `mock` nu). |
| `COLOMBE_DEMO_TTL_HOURS` | `4` | Durée de vie d'un compte de démonstration avant suppression automatique. |
| `COLOMBE_DEMO_MAX_ACCOUNTS` | `200` | Nombre maximal de comptes de démonstration simultanés (protège contre un abus qui saturerait la mémoire du processus). |
| `COLOMBE_PROJECT_URL` | — | Lien vers le projet, affiché aux visiteurs de la démonstration. |

`NUXT_SESSION_PASSWORD` et `WEBMAIL_DATA_KEY` restent **obligatoires**, même en mode
démonstration (le cookie de session est toujours chiffré). En revanche, `WEBMAIL_DATA_DIR`
est ignoré : tout vit en mémoire, rien n'est écrit sur disque.

## Déploiement de référence : Dokploy

La démonstration officielle tourne sur [Dokploy](https://dokploy.com/) (PaaS
auto-hébergé ; Traefik gère les domaines et le HTTPS). Les fichiers vivent dans
`deploy/dokploy/` :

- `docker-compose.yml` — deux services :
  - `colombe` : construit depuis le `Dockerfile` principal à la racine du dépôt, avec les
    variables d'environnement du mode démonstration ;
  - `site` : construit depuis `deploy/dokploy/site.Dockerfile`, qui compile le site de
    documentation VitePress et le sert en statique sur le port 8080.
- `deploy/dokploy/README.md` — le pas-à-pas complet de configuration Dokploy.

### Mise en place dans Dokploy

1. Créer un service **Compose** pointant vers le dépôt GitHub
   `jules-crevoisier/colombe`, branche `demo`, avec le chemin de compose
   `deploy/dokploy/docker-compose.yml`.
2. Renseigner les variables d'environnement : `NUXT_SESSION_PASSWORD`, `WEBMAIL_DATA_KEY`
   (générées avec `openssl rand -base64 32`, différentes l'une de l'autre),
   `COLOMBE_PROJECT_URL` (adresse du site), `COLOMBE_DEMO_URL` (adresse de la démo, pour le
   bouton « Essayer la démo » du site) et `COLOMBE_SITE_URL` (adresse du site, pour l’image de
   partage et le plan du site), et facultativement `COLOMBE_DEMO_TTL_HOURS` /
   `COLOMBE_DEMO_MAX_ACCOUNTS` pour changer leurs valeurs par défaut.
3. Domaines, dans l'interface Dokploy :
   - domaine du site vitrine → service `site`, port `8080` ;
   - domaine de la démonstration → service `colombe`, port `3000` ;
   - HTTPS activé sur les deux (Traefik gère les certificats automatiquement).

### Mettre à jour

Dokploy redéploie automatiquement sur chaque évolution de la branche `demo`. Mettre à jour
la démonstration revient donc à fusionner `main` dans `demo` (`git merge main`, poussé sur
`demo`) une fois les correctifs voulus publiés sur `main`.

## Ailleurs que Dokploy

Le fichier `deploy/dokploy/docker-compose.yml` n'a rien de spécifique à Dokploy : il
fonctionne avec `docker compose up -d` sur n'importe quel hôte Docker, derrière le reverse
proxy de votre choix (voir [Proxy inverse](/admin/proxy-inverse)) plutôt que Traefik.
Seule la gestion automatique des domaines/certificats est alors à votre charge.

## Développement local

Sans rapport avec la démonstration publique : pour développer Colombe sans aucun serveur
de messagerie, le backend `mock` seul suffit (`MAIL_BACKEND=mock`), avec les comptes
`dev@universite.example` / `dev-password` et `alice@universite.example` /
`alice-password` — voir [Contribuer](/contribuer).
