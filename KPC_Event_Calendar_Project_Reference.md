# KPC Event Calendar — Référence projet

*Mis à jour le 1er octobre 2026 — Christel Carbonnel, KPC Group Marketing*

## 1. Objectif et liens

Calendrier des événements business externes de KPC, diffusé aux sales. Il se met à jour automatiquement depuis Notion.

| Élément | Lien |
|---|---|
| Calendrier en ligne | https://christelkpc.github.io/kpceventcalendar/ |
| Dépôt GitHub | https://github.com/ChristelKPC/kpceventcalendar |
| Base Notion events | « Projets v26 » — `eab423ab172548c8860eb2d0ea65ba49` |
| Base Notion éditeurs | « Partenaires » (Master Databases) — `7e0823b294fb41ce851071b04874d7ea` |

Contenu du dépôt :

| Fichier | Rôle |
|---|---|
| `index.html` | La page du calendrier. Lit `data.json`. |
| `data.json` | Les données du calendrier. Généré automatiquement, ne pas modifier à la main. |
| `scripts/update.mjs` | Le script : lecture Notion, règles, récap Teams, alerte. |
| `.github/workflows/calendrier.yml` | La planification (chaque lundi) et le lancement manuel. |
| `state/` | Mémoire du dernier envoi, pour calculer les nouveautés. Ne pas modifier. |

## 2. Fonctionnement automatique

- **Chaque lundi vers 7h30** (6h30 en hiver), avec un second passage de secours vers 10h (9h en hiver) : lecture de Notion, mise à jour de `data.json`, le calendrier en ligne suit. GitHub peut retarder une tâche planifiée de quelques dizaines de minutes ; le récap n'est jamais envoyé deux fois le même jour.
- **1er et 3e lundis du mois** : envoi du récap dans la conversation Teams « Sales & Marketing ».
- **Chaque lundi, si besoin** : alerte personnelle dans la conversation Teams « Flux de travail » quand quelque chose est à corriger dans Notion :
  - date dépassée toujours « à confirmer » ;
  - event sans date de fin (absent du calendrier) ;
  - éditeur illisible (accès Partenaires).
- **En cas d'échec** (jeton expiré, base non partagée…) : message d'erreur dans « Flux de travail ».

Seule action à faire : tenir Notion à jour.

## 3. Règles de données

**Inclus**
- Nature (ventilation) = « Événements business (externes) »
- Statut Notion = Validé, Actif ou Terminé

**Exclus**
- Statuts A valider, Non validé, Annulé, Requalifié
- Nom contenant « Template »
- « PROVISION EVENT NON PROGRAMME »
- Event sans date de fin

**Champs**
- **Date** : `Date de fin / livraison`.
- **Format** : `📅 Externes` = Webinaire → Webinaire ; toute autre valeur ou vide → Présentiel.
- **Éditeurs** : nom lu directement dans la base Partenaires, sans map à maintenir. « KPC » et « Sans éditeur » signifient « pas d'éditeur partenaire » et sont masqués partout. Pour faire apparaître un partenaire, le renseigner dans `Éditeurs`.
- **Code SF** : espaces retirés ; « Sans objet » → vide. Affiché « Code SF : … ».
- **Date à confirmer** : badge ⚠ si le nom contient `date a confirmer`, `date à définir`, `date à identifier`, `date à voir`, `idée A voir` ou `??` (insensible à la casse et aux accents).

Les noms d'events s'affichent tels que saisis dans Notion : une faute dans Notion se retrouve dans le calendrier et dans le récap.

## 4. Règles d'affichage du calendrier

- **Statut affiché** (la nuance Validé / Actif n'est pas utile aux sales) :
  - date à venir → **Actif** ;
  - date passée → **Terminé**, carte grisée ;
  - exception : un event « à confirmer » reste **Actif** avec ⚠, même si sa date est passée, et ne compte pas comme réalisé.
- **Période** : année en cours + année suivante.
- **Liste des mois** : les 12 mois de l'année en cours, plus les mois de l'année suivante qui contiennent des events.
- **Jauge et récapitulatif** : année en cours uniquement (« X / Y événements réalisés en 2026 »). Bascule automatique au 1er janvier.
- **Repère année précédente** : nombre total d'events, affiché à partir de 2027. Pas de 2025, les données Notion n'étaient pas organisées de la même façon.
- **Vue par défaut** : à partir du mois en cours ; les mois passés s'affichent via les filtres.

## 5. Récap Teams pour les sales

Structure :
1. Titre : « Calendrier events KPC — mise à jour du [date] »
2. **Nouveautés depuis le dernier envoi** (masqué si rien) : nouvel event, date modifiée, date confirmée, annulé ou retiré.
3. **À venir** : 2 mois glissants, groupés par mois.
4. Rappel Salesforce et bouton « Voir le calendrier ».

Le premier envoi ne contient que « À venir » (aucun envoi précédent à comparer).

Textes modifiables : en haut de `scripts/update.mjs`, bloc `CONFIG.textes` (titre, rappel SF, bouton). Le rythme d'envoi et l'horizon sont réglables dans le même bloc `CONFIG`.

## 6. Secrets et connexions

Les valeurs ne sont jamais écrites dans un document ou une conversation. Elles sont stockées uniquement dans GitHub → Settings → Secrets and variables → Actions.

| Secret GitHub | Contenu | Où le récupérer |
|---|---|---|
| `NOTION_TOKEN` | Jeton de la connexion Notion « Calendrier events GitHub » | Notion → Paramètres → Développeur → Ouvrir les outils de développement → Connexions |
| `TEAMS_WEBHOOK_URL` | URL du flux Teams vers « Sales & Marketing » | Teams → app Flux de travail → flux du récap → Copier le lien du webhook |
| `TEAMS_ALERT_WEBHOOK_URL` | URL du flux « Alertes calendrier events » | Teams → app Flux de travail → « Alertes calendrier events » → Copier le lien du webhook |

**Connexion Notion** « Calendrier events GitHub » : lecture du contenu uniquement, aucune information utilisateur. Elle doit être ajoutée (… → Connexions) sur la base Projets v26 et sur la base Partenaires.

**Flux Teams** :
- récap sales → conversation « Sales & Marketing » ;
- « Alertes calendrier events » → conversation privée « Flux de travail », publiée par le bot de flux.

## 7. Actions manuelles

**Tester ou envoyer à la demande**
GitHub → Actions → « Calendrier events — mise à jour et récap » → Run workflow, puis choisir le mode :
- `test` : met à jour le calendrier et envoie l'aperçu du récap (et l'alerte s'il y a lieu) uniquement dans ta conversation privée « Flux de travail » ; rien n'est posté aux sales ;
- `envoi-sales` : poste le récap aux sales immédiatement ;
- `envoi-alerte` : poste l'alerte immédiatement (si quelque chose est à signaler).

**Nouvelle base Notion (ex. « Projets v27 »)**
1. Ajouter la connexion « Calendrier events GitHub » sur la nouvelle base.
2. Dans `scripts/update.mjs`, bloc `CONFIG.sources`, ajouter une ligne avec le nom, l'ID de data source et l'ID de base. Garder « Projets v26 » tant que des events 2026 doivent apparaître.

**Remplacer un jeton ou un webhook**
- Webhook : supprimer le flux dans Teams, le recréer, puis mettre à jour le secret GitHub correspondant.
- Jeton Notion : le régénérer dans la connexion, puis mettre à jour `NOTION_TOKEN`.

**Alerte d'échec reçue**
Lire le message, puis GitHub → Actions → dernière exécution en rouge → étape en erreur. Causes fréquentes : base non partagée avec la connexion, jeton révoqué, secret manquant.

**Modifier un fichier du dépôt**
Ouvrir le dossier concerné → Add file → Upload files → déposer le fichier (il remplace l'ancien du même nom) → Commit changes. Préférer l'upload au copier-coller.

**Confidentialité (dépôt public)**
- Le calendrier n'est pas indexé par les moteurs de recherche (balise `noindex`), mais reste accessible à toute personne qui a le lien.
- Les journaux GitHub n'affichent que des chiffres, jamais de noms d'events.
- Le dépôt, son historique et `data.json` restent publics. Piste à l'étude : hébergement interne avec connexion KPC obligatoire et dépôt privé.

**Si le site affiche 404**
Settings → Pages → vérifier que la branche `main` est sélectionnée → Save.

## 8. Historique des versions

| Date | Changements |
|---|---|
| Juin 2026 | Création du calendrier, synchronisation Notion, codes SF depuis la propriété dédiée |
| Juin 2026 | Ajout Semarchy, Oracle Rex Compass, Salon Data Nantes, Pigment Catalyst, SUG Lyon |
| Octobre 2026 | Automatisation complète : mise à jour hebdomadaire depuis Notion (GitHub Actions), récap Teams aux sales les 1er et 3e lundis, alerte personnelle. Éditeurs lus dans Notion (map supprimé, KPC masqué). Statut selon la date, badge ⚠ « À confirmer », calendrier sur deux années, jauge et récap sur l'année en cours. Page non indexée, journaux GitHub sans noms d'events. |
