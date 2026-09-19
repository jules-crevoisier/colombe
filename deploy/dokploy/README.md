# Démo publique de Colombe — déploiement Dokploy

Ce dossier déploie deux choses sur un VPS séparé de la production de l'IUT,
via [Dokploy](https://dokploy.com) (PaaS auto-hébergé : Traefik + domaines +
HTTPS gérés dans son interface) :

- **`colombe`** — l'application en mode démo (comptes temporaires isolés,
  backend mail en mémoire) ;
- **`site`** — le site vitrine statique du projet (VitePress, `docs/`).

Les deux services sont **construits depuis ce dépôt** à chaque déploiement
(pas d'image pré-publiée à gérer séparément pour la démo). Voir
`docker-compose.yml`, `site.Dockerfile` et `Caddyfile` pour le détail ; ce
fichier documente uniquement la configuration côté interface Dokploy.

## Prérequis

- Un serveur Dokploy déjà installé et accessible, avec un projet créé (ou à
  créer) pour la démo.
- Deux enregistrements DNS de type A pointant vers l'IP du serveur Dokploy :
  un pour le site vitrine, un pour la démo elle-même (deux sous-domaines
  distincts, par exemple `colombe.exemple.org` et `demo.colombe.exemple.org`).
- La branche `demo` de ce dépôt (voir §Mise à jour) poussée sur GitHub.

## 1. Créer le service Compose

Dans le projet Dokploy :

1. **Create Service → Compose**.
2. **Source → Git Provider** : GitHub, dépôt `jules-crevoisier/colombe`,
   branche `demo`.
3. **Compose Path** : `deploy/dokploy/docker-compose.yml`.
4. Laisser **Compose Type** sur `docker-compose` (pas `stack`).

## 2. Variables d'environnement

Onglet **Environment** du service Compose, une variable par ligne
(`CLÉ=valeur`) :

```env
NUXT_SESSION_PASSWORD=<généré ci-dessous>
WEBMAIL_DATA_KEY=<généré ci-dessous, DIFFÉRENT du précédent>
COLOMBE_PROJECT_URL=https://colombe.exemple.org
# Optionnelles (valeurs par défaut du contrat démo sinon) :
# COLOMBE_DEMO_TTL_HOURS=4
# COLOMBE_DEMO_MAX_ACCOUNTS=200
```

Générer les deux secrets (32 caractères minimum chacun, doivent être
différents l'un de l'autre) :

```sh
openssl rand -base64 32   # NUXT_SESSION_PASSWORD
openssl rand -base64 32   # WEBMAIL_DATA_KEY
```

Dokploy écrit ces variables dans un `.env` à côté du fichier compose ; c'est
`docker-compose.yml` (via `${VARIABLE}`) qui les reprend explicitement dans
les conteneurs — voir les commentaires du fichier. Si `NUXT_SESSION_PASSWORD`
ou `WEBMAIL_DATA_KEY` manque, le déploiement échoue tout de suite (message
d'erreur explicite) plutôt que de démarrer avec un secret vide.

## 3. Domaines

Onglet **Domains** du service Compose, deux entrées :

| Domaine (Host) | Service | Port conteneur | HTTPS |
|---|---|---|---|
| `colombe.exemple.org` (site vitrine) | `site` | `8080` | activé |
| `demo.colombe.exemple.org` (démo) | `colombe` | `3000` | activé |

Activer **HTTPS** sur les deux (Let's Encrypt, géré par Dokploy/Traefik — rien
à configurer côté `Caddyfile`, qui ne sert que du HTTP en clair en interne).

## 4. Déployer

Bouton **Deploy**. Dokploy construit les deux images (`Dockerfile` pour
`colombe`, `site.Dockerfile` pour `site`) et les démarre sur le réseau
`dokploy-network`. Activer **Auto Deploy** (webhook GitHub) pour redéployer
automatiquement à chaque push sur `demo`.

Vérifier ensuite :

- `https://colombe.exemple.org/` → le site vitrine.
- `https://demo.colombe.exemple.org/api/health` → `{"status":"ok",...}`.
- `https://demo.colombe.exemple.org/login` → la page de connexion, avec un
  lien « Essayer la démo ».

## Mettre à jour

La branche `demo` reste délibérément séparée de `main` (une démo publique
n'a pas besoin de suivre chaque commit). Pour publier une mise à jour :

```sh
git checkout demo
git merge main
git push
```

Avec **Auto Deploy** activé, Dokploy redéploie seul. Sinon, cliquer sur
**Deploy** dans son interface.

## Limites connues

- Le mode démo garde tout en mémoire (pas de volume `/data` pour `colombe`
  dans ce compose) : un redémarrage du conteneur efface les comptes de
  démonstration en cours — c'est le comportement voulu.
- Le contrat du mode démo (`COLOMBE_DEMO`, `COLOMBE_DEMO_TTL_HOURS`,
  `COLOMBE_DEMO_MAX_ACCOUNTS`) est documenté et implémenté ailleurs
  (`server/lib/config`, en cours d'écriture au moment de ce commit) : si les
  noms de variables changent, mettre à jour `docker-compose.yml` en
  conséquence.
- Le script `pnpm docs:build` (site VitePress, `docs/`) est lui aussi en
  cours d'écriture ailleurs au moment de ce commit : `site.Dockerfile` y
  échouera tant qu'il n'existe pas. Voir `docs/.vitepress/dist/index.html`
  comme critère de succès (vérifié explicitement dans `site.Dockerfile`).
