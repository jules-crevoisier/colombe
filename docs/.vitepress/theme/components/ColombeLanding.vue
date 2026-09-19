<script setup lang="ts">
/**
 * Page d'accueil du site. Les blocs de code (installation) viennent de docs/index.md
 * par des emplacements nommés, pour profiter de la coloration et du bouton « Copier »
 * de VitePress.
 */
import { computed } from 'vue'
import { useData, withBase } from 'vitepress'
import type { ColombeThemeConfig } from '../../config.mts'
import DoveMark from './DoveMark.vue'
import ShotFrame from './ShotFrame.vue'
import '../landing.css'

const { theme } = useData<ColombeThemeConfig>()
const demoUrl = computed(() => theme.value.colombe.demoUrl)
const repoUrl = computed(() => theme.value.colombe.repoUrl)

const securityFacts = [
  {
    title: 'Le HTML des messages est assaini, puis isolé',
    text: 'DOMPurify côté serveur, puis affichage dans une iframe sandbox, sans scripts ni même origine. Un message piégé reste un texte inerte.',
  },
  {
    title: 'Les images distantes sont bloquées',
    text: 'Aucun pixel de traçage à l’ouverture. L’utilisateur les affiche d’un clic, ou toujours pour ses contacts s’il le choisit.',
  },
  {
    title: 'Le mot de passe ne quitte jamais le serveur',
    text: 'Le navigateur ne reçoit qu’un cookie chiffré, HttpOnly et Secure. Le mot de passe reste en mémoire, jamais sur disque, huit heures au plus.',
  },
  {
    title: 'Aucune ressource externe',
    text: 'Ni CDN, ni polices distantes, ni statistiques. La Content-Security-Policy n’autorise aucune autre origine, et un test automatique y veille.',
  },
  {
    title: 'Des limites de débit à chaque porte',
    text: 'Connexion : 5 échecs par compte et 30 par adresse IP en 15 minutes. Envoi : 20 messages par compte en 15 minutes. Une ligne de journal par échec, pour fail2ban.',
  },
  {
    title: 'Un transfert qui ne passe pas inaperçu',
    text: 'Seulement vers les domaines autorisés, avec mot de passe redemandé, alerte par e-mail au titulaire et trace dans son journal.',
  },
  {
    title: 'Double authentification pour qui la veut',
    text: 'Chaque utilisateur peut l’activer (TOTP, codes de secours). Sessions actives visibles et révocables, journal des connexions.',
  },
  {
    title: 'Un démarrage qui refuse le risque',
    text: 'Secrets absents ou trop courts, certificats non vérifiés, backend de démonstration en production : Colombe ne démarre pas.',
  },
]

const userFeatures = [
  { title: 'Une interface qui ressemble à Gmail', text: 'Liste, conversation, étoiles, glisser-déposer : on retrouve ses repères sans formation.' },
  { title: 'Pensée d’abord pour le téléphone', text: 'Dessinée à 320 pixels de large, puis élargie. Aucune application à installer.' },
  { title: 'Conversations', text: 'Les échanges sont regroupés à la lecture, les anciens messages repliés.' },
  { title: 'Un éditeur complet', text: 'Mise en forme, images, signatures par identité, réponses types, brouillons enregistrés au fil de la frappe.' },
  { title: 'Filtres, absence, transfert', text: 'Des règles façon Gmail et une réponse automatique, enregistrées sur le serveur avec Sieve.' },
  { title: 'Contacts et groupes', text: 'Autocomplétion, groupes, import et export vCard.' },
  { title: 'Le courrier en direct', text: 'Les nouveaux messages arrivent sans recharger la page, avec notifications du bureau.' },
  { title: 'Annuler l’envoi', text: 'Quelques secondes pour rattraper un message parti trop vite, ou une suppression.' },
  { title: 'Raccourcis clavier', text: 'Ceux de Gmail. La touche « ? » les affiche.' },
  { title: 'Mode sombre', text: 'Clair, sombre, ou selon le réglage de l’appareil.' },
  { title: 'Accessible', text: 'WCAG 2.2 AA vérifié : clavier, lecteurs d’écran, contrastes.' },
  { title: 'En français ou en anglais', text: 'Chacun choisit sa langue dans les réglages ; par défaut, celle de son navigateur.' },
]

const otherApps = [
  { name: 'Gmail sur téléphone', text: 'Ajout du compte en IMAP, avec les réglages exacts affichés dans Colombe, prêts à copier.' },
  { name: 'iPhone et iPad', text: 'Un profil de configuration à télécharger. Le mot de passe n’y figure pas : il est demandé à l’installation.' },
  { name: 'Outlook', text: 'Configuration automatique (Autodiscover) quand l’établissement l’active.' },
  { name: 'Thunderbird', text: 'Configuration automatique (autoconfig) : l’adresse et le mot de passe suffisent.' },
]

const adminFacts = [
  {
    title: 'Configuré par l’environnement',
    text: 'Six variables suffisent. Tout est vérifié au démarrage : s’il manque quelque chose, Colombe refuse de démarrer et liste chaque problème.',
    link: '/admin/configuration',
    label: 'Référence de configuration',
  },
  {
    title: 'Reprise de Roundcube',
    text: 'config.inc.php, puis contacts, groupes, identités, signatures et réponses types. Simulation par défaut, import rejouable.',
    link: '/admin/migration-roundcube',
    label: 'Migrer depuis Roundcube',
  },
  {
    title: 'Côte à côte pendant la transition',
    text: 'Les deux webmails parlent au même serveur. Un groupe pilote d’abord, la bascule quand vous êtes prêt.',
    link: '/admin/',
    label: 'Vue d’ensemble',
  },
  {
    title: 'Connexion unique de l’établissement',
    text: 'OpenID Connect : Keycloak et Apereo CAS testés de bout en bout, fédération RENATER/SAML par passerelle. La messagerie est ouverte par jeton vérifié par Dovecot, aucun mot de passe stocké.',
    link: '/admin/connexion-unique',
    label: 'Connexion unique',
  },
  {
    title: 'Annuaire de l’établissement',
    text: 'LDAP en lecture seule (schéma SupAnn) : les adresses de toute l’université se complètent toutes seules, et un onglet Annuaire les cherche.',
    link: '/admin/annuaire',
    label: 'Annuaire LDAP',
  },
  {
    title: 'Supervision et diagnostic',
    text: 'GET /api/health pour la supervision, colombe-doctor pour le diagnostic, filtre et prison fail2ban fournis.',
    link: '/admin/exploitation',
    label: 'Exploitation',
  },
]

const comparison = [
  { label: 'Technologie côté serveur', colombe: 'Node.js 24', roundcube: 'PHP', rainloop: 'PHP' },
  { label: 'Licence', colombe: 'AGPL-3.0', roundcube: 'GPL-3.0', rainloop: 'AGPL-3.0' },
  { label: 'Maintenance', colombe: 'Active', roundcube: 'Active', rainloop: 'RainLoop : plus de version depuis 2022. SnappyMail, son fork, est maintenu.' },
  { label: 'Administration', colombe: 'Variables d’environnement, vérifiées au démarrage. Aucune interface d’administration web.', roundcube: 'Fichier config.inc.php', rainloop: 'Interface d’administration web' },
  { label: 'Chiffrement PGP', colombe: 'Non prévu', roundcube: 'Oui (extension Enigma)', rainloop: 'Oui' },
]
</script>

<template>
  <div class="cl">
    <!-- ─── Ouverture ─────────────────────────────────────────────── -->
    <section class="cl-hero" aria-labelledby="cl-hero-title">
      <div class="cl-wrap cl-hero-grid">
        <DoveMark class="cl-hero-dove" />
        <div class="cl-hero-text">
          <p class="stamp cl-rise">Webmail libre · AGPL-3.0</p>
          <h1 id="cl-hero-title" class="cl-display cl-rise">
            Le webmail des établissements qui gardent leur courrier <em>chez&nbsp;eux</em>.
          </h1>
          <p class="cl-lede cl-rise">
            Colombe se branche sur votre serveur Dovecot et Postfix et remplace Roundcube ou
            RainLoop, sans toucher à la messagerie. Une interface que chacun comprend, une
            sécurité active dès l’installation.
          </p>
          <div class="cl-actions cl-rise">
            <a class="cl-btn cl-btn--primary" :href="demoUrl">Essayer la démo</a>
            <a class="cl-btn cl-btn--ghost" :href="withBase('/admin/')">Installer</a>
          </div>
          <ul class="cl-signals cl-rise" aria-label="En bref">
            <li>Logiciel libre</li>
            <li>Auto-hébergé</li>
            <li>Aucune ressource externe</li>
            <li>En production depuis septembre 2026</li>
          </ul>
        </div>
      </div>

      <div class="cl-wrap cl-hero-shot">
        <ShotFrame
          class="cl-only-desktop"
          src="/screenshots/inbox-light.png"
          dark="/screenshots/inbox-dark.png"
          alt="La boîte de réception de Colombe sur ordinateur : dossiers à gauche, liste des messages avec expéditeur, objet, aperçu et heure."
          :width="1440"
          :height="900"
        />
        <ShotFrame
          class="cl-only-mobile"
          device="phone"
          src="/screenshots/inbox-mobile.png"
          dark="/screenshots/inbox-mobile-dark.png"
          alt="La boîte de réception de Colombe sur téléphone : messages avec avatars à initiales et bouton « Nouveau message »."
          :width="780"
          :height="1688"
        />
      </div>
    </section>

    <!-- ─── Origine ───────────────────────────────────────────────── -->
    <section class="cl-section cl-origin" aria-labelledby="cl-origin-title">
      <div class="cl-wrap cl-split">
        <div>
          <p class="stamp">Pourquoi Colombe existe</p>
          <h2 id="cl-origin-title" class="cl-title">
            Né d’un incident, <em>pas d’un appel d’offres</em>.
          </h2>
        </div>
        <div class="cl-prose">
          <p>
            Un institut universitaire français a découvert un matin que son serveur de
            messagerie envoyait du spam. Personne n’avait forcé le serveur : des identifiants
            volés avaient suffi, et des comptes légitimes servaient de relais, jusqu’à ce que
            l’hébergeur bloque la machine.
          </p>
          <p>
            L’enquête a aussi trouvé un webmail abandonné par ses auteurs depuis des années,
            toujours exposé sur Internet, sans le moindre correctif. Il n’était pas la cause de
            l’incident. Il aurait pu être celle du suivant.
          </p>
          <p class="cl-prose-strong">
            Colombe a été écrit pour le remplacer, avec une règle : chaque protection est
            active dès l’installation. Un administrateur pressé ne doit pas pouvoir oublier
            de l’activer.
          </p>
        </div>
      </div>
    </section>

    <!-- ─── Sécurité ──────────────────────────────────────────────── -->
    <section class="cl-section cl-night" aria-labelledby="cl-security-title">
      <div class="cl-wrap">
        <div class="cl-head">
          <p class="stamp stamp--night">Sécurité par défaut</p>
          <h2 id="cl-security-title" class="cl-title">
            Des protections actives, <em>pas des options</em>.
          </h2>
          <p class="cl-lede">
            Ce que Colombe fait sans qu’on le lui demande, sur une installation neuve, avant
            tout réglage.
          </p>
        </div>
        <ul class="cl-facts">
          <li v-for="fact in securityFacts" :key="fact.title" class="cl-fact">
            <h3>{{ fact.title }}</h3>
            <p>{{ fact.text }}</p>
          </li>
        </ul>
        <p class="cl-night-more">
          <a :href="withBase('/admin/securite')">Le modèle de sécurité complet, y compris ce que Colombe ne fait pas</a>
        </p>
      </div>
    </section>

    <!-- ─── Pour les utilisateurs ─────────────────────────────────── -->
    <section class="cl-section" aria-labelledby="cl-users-title">
      <div class="cl-wrap">
        <div class="cl-head">
          <p class="stamp">Pour les utilisateurs</p>
          <h2 id="cl-users-title" class="cl-title">
            Familier <em>dès la première minute</em>.
          </h2>
          <p class="cl-lede">
            Ceux qui connaissent Gmail savent déjà s’en servir. Les autres trouvent une
            interface calme, lisible sur un téléphone comme sur un grand écran.
          </p>
        </div>

        <figure class="cl-figure">
          <ShotFrame
            src="/screenshots/message.png"
            alt="Un message ouvert dans Colombe : un bandeau indique que les images distantes sont masquées, avec un bouton « Afficher les images »."
            :width="1440"
            :height="900"
          />
          <figcaption>Un message ouvert : les images distantes restent masquées tant que vous ne les demandez pas.</figcaption>
        </figure>

        <ul class="cl-index">
          <li v-for="feature in userFeatures" :key="feature.title">
            <h3>{{ feature.title }}</h3>
            <p>{{ feature.text }}</p>
          </li>
        </ul>

        <div class="cl-pair">
          <figure class="cl-figure">
            <ShotFrame
              src="/screenshots/compose.png"
              alt="La fenêtre de rédaction de Colombe, ouverte à droite de la boîte de réception, avec la barre de mise en forme et le bouton « Envoyer »."
              :width="1440"
              :height="900"
            />
            <figcaption>La rédaction s’ouvre à côté de la boîte de réception.</figcaption>
          </figure>
          <figure class="cl-figure">
            <ShotFrame
              src="/screenshots/filters.png"
              alt="La création d’un filtre dans Colombe : critères (expéditeur, destinataire, objet, mots) et actions (archiver, marquer comme lu, suivre, classer, transférer)."
              :width="1440"
              :height="900"
            />
            <figcaption>Des filtres façon Gmail, enregistrés sur le serveur.</figcaption>
          </figure>
        </div>
      </div>
    </section>

    <!-- ─── Autres applications ───────────────────────────────────── -->
    <section class="cl-section cl-apps" aria-labelledby="cl-apps-title">
      <div class="cl-wrap cl-apps-grid">
        <div>
          <p class="stamp">Autres applications</p>
          <h2 id="cl-apps-title" class="cl-title cl-title--sm">
            Le même compte, <em>partout ailleurs</em>.
          </h2>
          <p class="cl-lede">
            L’onglet « Autres applications » donne à chacun ses réglages exacts et les étapes
            pour son logiciel, avec un code QR pour les ouvrir sur le téléphone.
          </p>
          <dl class="cl-apps-list">
            <div v-for="app in otherApps" :key="app.name">
              <dt>{{ app.name }}</dt>
              <dd>{{ app.text }}</dd>
            </div>
          </dl>
          <p class="cl-note">
            <strong>À savoir :</strong> depuis 2026, Gmail sur ordinateur ne relève plus les
            boîtes d’autres fournisseurs. Colombe l’explique à l’utilisateur et propose le
            transfert, si l’établissement autorise les adresses Gmail.
          </p>
          <p class="cl-more">
            <a :href="withBase('/guide/autres-applications')">Le guide à diffuser aux utilisateurs</a>
          </p>
        </div>
        <figure class="cl-figure">
          <ShotFrame
            src="/screenshots/settings-apps.png"
            alt="L’onglet « Autres applications » des paramètres : code QR, puis serveurs, ports, sécurité et identifiant pour la réception (IMAP) et l’envoi (SMTP)."
            :width="1440"
            :height="900"
          />
        </figure>
      </div>
    </section>

    <!-- ─── Pour les administrateurs ──────────────────────────────── -->
    <section class="cl-section cl-admin" aria-labelledby="cl-admin-title">
      <div class="cl-wrap">
        <div class="cl-head">
          <p class="stamp">Pour les administrateurs</p>
          <h2 id="cl-admin-title" class="cl-title">
            Remplace Roundcube, <em>pas votre serveur</em>.
          </h2>
          <p class="cl-lede">
            Colombe parle IMAP, SMTP et ManageSieve à votre serveur, exactement comme
            Roundcube. Dovecot et Postfix restent tels quels ; le courrier ne quitte pas le
            serveur IMAP.
          </p>
        </div>

        <div class="cl-admin-grid">
          <div class="cl-admin-code">
            <h3 class="cl-subtitle">Installer en quelques minutes</h3>
            <div class="vp-doc cl-code">
              <slot name="install" />
            </div>
            <h3 class="cl-subtitle">Le minimum à configurer</h3>
            <div class="vp-doc cl-code">
              <slot name="minimum" />
            </div>
            <p class="cl-requirements">
              Prérequis : Docker ou Node.js 24, un serveur IMAP et SMTP en TLS. ManageSieve
              (Dovecot Pigeonhole) pour les filtres.
            </p>
          </div>
          <ul class="cl-admin-facts">
            <li v-for="fact in adminFacts" :key="fact.title">
              <h3>{{ fact.title }}</h3>
              <p>{{ fact.text }}</p>
              <a :href="withBase(fact.link)">{{ fact.label }}</a>
            </li>
          </ul>
        </div>
      </div>
    </section>

    <!-- ─── Comparaison ───────────────────────────────────────────── -->
    <section class="cl-section" aria-labelledby="cl-compare-title">
      <div class="cl-wrap">
        <div class="cl-head">
          <p class="stamp">Comparaison</p>
          <h2 id="cl-compare-title" class="cl-title cl-title--sm">
            Colombe, Roundcube, RainLoop.
          </h2>
          <p class="cl-lede">
            Seulement ce que nous pouvons vérifier. Roundcube reste un logiciel solide ;
            Colombe fait d’autres choix, et n’a pas encore tout ce qu’il propose.
          </p>
        </div>
        <!-- Mobile : une fiche par critère plutôt qu'un tableau à faire défiler. -->
        <ul class="cl-compare-cards">
          <li v-for="row in comparison" :key="row.label">
            <h3>{{ row.label }}</h3>
            <dl>
              <div class="cl-compare-us"><dt>Colombe</dt><dd>{{ row.colombe }}</dd></div>
              <div><dt>Roundcube</dt><dd>{{ row.roundcube }}</dd></div>
              <div><dt>RainLoop / SnappyMail</dt><dd>{{ row.rainloop }}</dd></div>
            </dl>
          </li>
        </ul>
        <div class="cl-table-scroll" role="region" aria-labelledby="cl-compare-title" tabindex="0">
          <table class="cl-table">
            <thead>
              <tr>
                <th scope="col"><span class="cl-sr">Critère</span></th>
                <th scope="col" class="cl-table-us">Colombe</th>
                <th scope="col">Roundcube</th>
                <th scope="col">RainLoop / SnappyMail</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in comparison" :key="row.label">
                <th scope="row">{{ row.label }}</th>
                <td class="cl-table-us">{{ row.colombe }}</td>
                <td>{{ row.roundcube }}</td>
                <td>{{ row.rainloop }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="cl-more">
          <a :href="withBase('/admin/migration-roundcube')">Correspondance fonction par fonction avec Roundcube</a>
        </p>
      </div>
    </section>

    <!-- ─── Logiciel libre ────────────────────────────────────────── -->
    <section class="cl-section cl-open" aria-labelledby="cl-open-title">
      <div class="cl-wrap cl-open-grid">
        <div>
          <p class="stamp">Logiciel libre</p>
          <h2 id="cl-open-title" class="cl-title">
            Libre, <em>et fait pour être repris</em>.
          </h2>
          <p class="cl-lede">
            Colombe est distribué sous licence GNU AGPL-3.0 : vous pouvez l’utiliser,
            l’étudier, le modifier et le redistribuer. Si vous proposez en ligne une version
            modifiée, vous en publiez le code. En production dans un institut universitaire
            français depuis septembre 2026.
          </p>
          <div class="cl-actions">
            <a class="cl-btn cl-btn--primary" :href="demoUrl">Essayer la démo</a>
            <a class="cl-btn cl-btn--ghost" :href="repoUrl">Voir le code source</a>
            <a class="cl-btn cl-btn--ghost" :href="withBase('/contribuer')">Contribuer</a>
          </div>
        </div>
        <DoveMark class="cl-open-dove" />
      </div>
    </section>

    <!-- ─── Pied de page ──────────────────────────────────────────── -->
    <footer class="cl-footer">
      <div class="cl-wrap cl-footer-grid">
        <div class="cl-footer-brand">
          <p class="cl-footer-name">
            <img :src="withBase('/logo.svg')" alt="" width="28" height="28">
            Colombe
          </p>
          <p>Webmail libre pour les établissements qui exploitent leur propre serveur de messagerie.</p>
          <p>Ce site n’utilise ni cookie, ni statistiques, ni ressource externe.</p>
        </div>
        <nav aria-label="Documentation">
          <h2>Documentation</h2>
          <ul>
            <li><a :href="withBase('/guide/')">Guide utilisateur</a></li>
            <li><a :href="withBase('/admin/')">Administration</a></li>
            <li><a :href="withBase('/admin/securite')">Sécurité</a></li>
            <li><a :href="withBase('/admin/migration-roundcube')">Migrer depuis Roundcube</a></li>
          </ul>
        </nav>
        <nav aria-label="Projet">
          <h2>Projet</h2>
          <ul>
            <li><a :href="repoUrl">Code source</a></li>
            <li><a :href="`${repoUrl}/blob/main/CHANGELOG.md`">Journal des versions</a></li>
            <li><a :href="`${repoUrl}/blob/main/SECURITY.md`">Signaler une faille</a></li>
            <li><a :href="withBase('/contribuer')">Contribuer</a></li>
          </ul>
        </nav>
      </div>
      <div class="cl-wrap cl-footer-legal">
        <p>
          Distribué sous licence <a :href="`${repoUrl}/blob/main/LICENSE`">GNU AGPL-3.0</a> ou
          ultérieure. Polices Newsreader et Instrument Sans sous licence SIL OFL 1.1.
        </p>
      </div>
    </footer>
  </div>
</template>
