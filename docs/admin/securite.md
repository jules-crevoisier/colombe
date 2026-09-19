# Sécurité

Colombe est né d'un incident réel : un serveur de messagerie utilisé comme relais de spam
après le vol d'identifiants d'utilisateurs, avec un webmail abandonné, exposé sur
Internet sans correctif de sécurité depuis des années. La sécurité n'est pas ici une
option de style : les choix ci-dessous en découlent directement.

## Ce que Colombe fait

**Contenu des messages**
- Tout HTML reçu est assaini (DOMPurify) côté serveur, puis affiché dans une `iframe`
  `sandbox` **sans** `allow-scripts` ni `allow-same-origin`.
- Images distantes bloquées par défaut (pas de pixel de traçage à l'ouverture) ; chargées
  sur action explicite, ou automatiquement pour ses contacts si l'utilisateur le choisit.
- Pièces jointes servies en `Content-Disposition: attachment` avec
  `X-Content-Type-Options: nosniff`, jamais affichées dans la page.
- Images de signature intégrées au message (`cid:`) : aucune URL distante n'est envoyée.

**Identifiants et sessions**
- Le mot de passe ne va jamais au navigateur et n'est jamais écrit sur disque : le cookie
  (`HttpOnly`, `Secure`, `SameSite=Lax`, chiffré) ne contient qu'un identifiant de session ;
  le mot de passe reste en mémoire du serveur, 8 h au plus, 2 h d'inactivité.
- Double authentification TOTP facultative, avec codes de secours ; secrets chiffrés par
  `WEBMAIL_DATA_KEY`.
- Sessions actives visibles et révocables par l'utilisateur ; journal des connexions.
- Limitation des tentatives : 5 échecs par compte et 30 par IP en 15 minutes (le seuil par
  IP tient compte des établissements derrière une seule IP NAT). Une ligne par échec pour
  fail2ban (`deploy/fail2ban/`).
- Seuls les domaines de `MAIL_DOMAINS` peuvent se connecter : Colombe ne sert pas à tester
  des mots de passe sur d'autres serveurs.

**Envoi et transfert**
- Envois limités par compte (20 messages en 15 minutes) : un compte volé ne devient pas un
  relais de spam par le webmail.
- Transfert et redirection limités aux domaines de `MAIL_FORWARD_DOMAINS` ; toute création
  ou modification demande le mot de passe (ou le code 2FA), envoie une alerte par e-mail
  au titulaire et s'inscrit dans son journal d'activité.

**Application web**
- En-têtes : `Content-Security-Policy` (aucune origine externe), HSTS,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`.
- Contrôle de l'origine sur toute requête modifiante (en plus de `SameSite`).
- **Aucune ressource externe** : ni CDN, ni polices Google, ni statistiques. Un test
  automatique l'impose.
- Démarrage refusé si la configuration est dangereuse : secrets absents ou trop courts,
  vérification TLS désactivée, serveur de démonstration en production.

## Ce que Colombe ne fait pas (à traiter ailleurs)

- **Protéger le serveur de messagerie lui-même.** Les attaques par mot de passe visent aussi
  IMAP et SMTP directement : fail2ban sur Dovecot et Postfix, limites d'envoi dans Postfix
  (`smtpd_client_message_rate_limit`, politique de quota), surveillance de la file d'attente.
- **Changer le mot de passe.** Utilisez l'outil de votre établissement et renseignez
  `COLOMBE_PASSWORD_RESET_URL` pour y renvoyer.
- **Remplacer une authentification forte centrale.** La double authentification de Colombe
  ne protège que le webmail : un mot de passe volé reste utilisable en IMAP par un autre
  logiciel. Une connexion unique **OpenID Connect** est disponible (Keycloak et Apereo CAS
  7.1 testés de bout en bout ; Shibboleth, Entra ID, Google Workspace documentés mais non
  testés — voir [Connexion unique](/admin/connexion-unique)) ; **SAML natif** n'est pas
  parlé directement par Colombe (une passerelle OIDC devant un IdP SAML, ex. SATOSA — non
  testée — ou Keycloak en SP/OP — testée — est l'architecture recommandée).
- **Haute disponibilité.** Sessions et limites de débit sont en mémoire d'un seul
  processus : pas de répartition de charge entre plusieurs instances, déconnexion de tous
  au redémarrage.

## Recommandations

1. Mettre à jour Colombe à chaque version (les dépendances de sécurité sont suivies ;
   `pnpm audit` fait partie de la revue avant publication).
2. `MAIL_TRUST_PROXY=true` seulement si le port de Colombe n'est joignable que par le proxy
   (`HOST=127.0.0.1`), sinon un client pourrait choisir l'IP inscrite dans les journaux.
3. Sauvegarder `WEBMAIL_DATA_KEY` hors du serveur.
4. Garder `MAIL_FORWARD_DOMAINS` au plus juste (voir [Configuration](/admin/configuration#filtres-reponse-automatique-transfert-sieve)).
5. Signaler une vulnérabilité : voir `SECURITY.md` à la racine du projet.

## Et ensuite

- [Exploitation](/admin/exploitation) : mises à jour, sauvegardes, supervision.
- [Dépannage](/admin/depannage).
