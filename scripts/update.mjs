// Calendrier events KPC : lecture Notion → data.json → récap Teams (sales) + alerte personnelle
// Lancé par .github/workflows/calendrier.yml. Node 20+ (fetch natif), aucune dépendance.

import fs from 'node:fs/promises';

// ─────────────────────────────────────────────────────────────
// RÉGLAGES (modifiables sans toucher au reste)
// ─────────────────────────────────────────────────────────────
const CONFIG = {
  // Bases Notion lues. Si une base « Projets v27 » est créée, ajouter une ligne ici.
  sources: [
    { nom: 'Projets v26', dataSourceId: '36453961-a2e5-4d3f-96e6-17ee81953efb', databaseId: 'eab423ab172548c8860eb2d0ea65ba49' },
  ],
  calendrierUrl: 'https://christelkpc.github.io/kpceventcalendar/',
  premiereAnnee: 2026,          // pas de repère « année précédente » avant cette année + 1
  horizonMois: 2,               // section « À venir » du récap
  joursEnvoi: [[1, 7], [15, 21]], // 1er et 3e lundi du mois
  textes: {
    titre: 'Calendrier events KPC',
    rappelSF: 'Rappel : les codes de campagne Salesforce de chaque event sont dans le calendrier. Utilisez-les pour vos envois d\'invitation.',
    bouton: 'Voir le calendrier',
    rienAVenir: 'Aucun event prévu sur les 2 prochains mois.',
  },
};

const PROP = {
  nom: 'Nom du projet',
  date: 'Date de fin / livraison',
  format: '📅 Externes',
  editeurs: 'Éditeurs',
  statut: 'Statut',
  codeSF: 'Code SF',
  nature: 'Nature (ventilation)',
};
const NATURE_OK = 'Événements business (externes)';
const STATUTS_OK = ['actif', 'valide', 'termine'];
const NOMS_EXCLUS = ['provision event non programme'];
const MARQUEURS_DATE = ['date a confirmer', 'date a definir', 'date a identifier', 'date a voir', 'idee a voir', '??'];

// ─────────────────────────────────────────────────────────────
// Utilitaires
// ─────────────────────────────────────────────────────────────
const norm = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const env = (k) => (process.env[k] || '').trim();

function aujourdhuiParis() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}
function ajouterMois(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, d));
  return dt.toISOString().slice(0, 10);
}
const fmt = (iso, opts) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', ...opts }).format(new Date(iso + 'T00:00:00Z'));
const dateCourte = (iso) => fmt(iso, { weekday: 'short', day: 'numeric', month: 'short' });
const premier = (s) => s.replace(/(^|\s)1 (?=\p{L})/u, '$11er ');
const dateLongue = (iso) => premier(fmt(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
const moisAnnee = (iso) => { const s = fmt(iso, { month: 'long', year: 'numeric' }); return s[0].toUpperCase() + s.slice(1); };

function estJourEnvoi(iso) {
  const jour = Number(iso.slice(8, 10));
  const lundi = new Date(iso + 'T00:00:00Z').getUTCDay() === 1;
  return lundi && CONFIG.joursEnvoi.some(([a, b]) => jour >= a && jour <= b);
}

async function lireJson(chemin, defaut) {
  try { return JSON.parse(await fs.readFile(chemin, 'utf8')); } catch { return defaut; }
}
const ecrireJson = (chemin, data) => fs.writeFile(chemin, JSON.stringify(data, null, 2) + '\n', 'utf8');

// ─────────────────────────────────────────────────────────────
// Notion
// ─────────────────────────────────────────────────────────────
async function notion(chemin, { method = 'GET', body, version = '2025-09-03' } = {}) {
  const res = await fetch('https://api.notion.com/v1/' + chemin, {
    method,
    headers: {
      Authorization: 'Bearer ' + env('NOTION_TOKEN'),
      'Notion-Version': version,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Notion ${res.status} sur ${chemin} : ${data.message || res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function lirePagesSource(source) {
  const filtre = { property: PROP.nature, select: { equals: NATURE_OK } };
  const pages = [];
  let cursor;
  let mode = 'data_sources';
  do {
    const body = { filter: filtre, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) };
    let data;
    if (mode === 'data_sources') {
      try {
        data = await notion(`data_sources/${source.dataSourceId}/query`, { method: 'POST', body });
      } catch (e) {
        if (e.status === 404) throw new Error(`La base « ${source.nom} » n'est pas accessible : vérifier que la connexion « Calendrier events GitHub » y est ajoutée (… → Connexions).`);
        if (e.status !== 400) throw e;
        mode = 'databases'; // repli sur l'ancienne API
        data = await notion(`databases/${source.databaseId}/query`, { method: 'POST', body, version: '2022-06-28' });
      }
    } else {
      data = await notion(`databases/${source.databaseId}/query`, { method: 'POST', body, version: '2022-06-28' });
    }
    pages.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return pages;
}

function texteProp(p) {
  if (!p) return '';
  switch (p.type) {
    case 'title': return p.title.map((t) => t.plain_text).join('');
    case 'rich_text': return p.rich_text.map((t) => t.plain_text).join('');
    case 'select': return p.select?.name || '';
    case 'status': return p.status?.name || '';
    case 'formula': return p.formula?.string ?? '';
    default: return '';
  }
}

const cacheEditeurs = new Map();
async function nomEditeur(id) {
  if (cacheEditeurs.has(id)) return cacheEditeurs.get(id);
  let nom = null;
  try {
    const page = await notion(`pages/${id}`);
    const titre = Object.values(page.properties || {}).find((p) => p.type === 'title');
    nom = texteProp(titre).trim() || null;
  } catch { nom = null; }
  cacheEditeurs.set(id, nom);
  return nom;
}

// ─────────────────────────────────────────────────────────────
// Règles du calendrier
// ─────────────────────────────────────────────────────────────
async function versEvent(page, problemes) {
  const p = page.properties || {};
  const nom = texteProp(p[PROP.nom]).trim();
  const statutNotion = texteProp(p[PROP.statut]);
  const date = p[PROP.date]?.date?.start?.slice(0, 10) || '';

  if (!nom || !STATUTS_OK.includes(norm(statutNotion))) return null;
  if (norm(nom).includes('template') || NOMS_EXCLUS.includes(norm(nom))) return null;
  if (!date) {
    problemes.push({ type: 'sansDate', nom, url: page.url });
    return null;
  }

  const formatBrut = texteProp(p[PROP.format]);
  const format = norm(formatBrut) === 'webinaire' ? 'Webinaire' : 'Présentiel';

  const editeurs = [];
  for (const rel of p[PROP.editeurs]?.relation || []) {
    const n = await nomEditeur(rel.id);
    if (n) editeurs.push(n);
    else { editeurs.push('?'); problemes.push({ type: 'editeur', nom, url: page.url }); }
  }

  let codeSF = texteProp(p[PROP.codeSF]).replace(/^\s+|\s+$/g, '');
  if (norm(codeSF) === 'sans objet') codeSF = '';

  const dateWarning = MARQUEURS_DATE.some((m) => norm(nom).includes(m));

  return { id: page.id.replace(/-/g, ''), nom, date, format, editeurs, codeSF, dateWarning, url: page.url };
}

function avecStatut(ev, today) {
  // Badge affiché : « Terminé » si la date est passée, sauf date encore « à confirmer »
  const termine = !ev.dateWarning && ev.date < today;
  return { ...ev, statut: termine ? 'Terminé' : 'Actif' };
}

// ─────────────────────────────────────────────────────────────
// Différences depuis le dernier envoi
// ─────────────────────────────────────────────────────────────
function differences(avant, maintenant, today) {
  if (!avant) return null;
  const old = new Map(avant.events.map((e) => [e.id, e]));
  const cur = new Map(maintenant.map((e) => [e.id, e]));
  const nouveaux = [], dateModifiee = [], dateConfirmee = [], annules = [];

  for (const e of maintenant) {
    const o = old.get(e.id);
    if (!o) { if (e.date >= today) nouveaux.push(e); continue; }
    if (o.dateWarning && !e.dateWarning && e.date >= today) { dateConfirmee.push(e); continue; }
    if (o.date !== e.date && (e.date >= today || o.date >= today)) dateModifiee.push({ ...e, ancienneDate: o.date });
  }
  for (const o of avant.events) {
    if (!cur.has(o.id) && o.date >= today) annules.push(o);
  }
  const tri = (a, b) => a.date.localeCompare(b.date);
  return {
    depuis: avant.date,
    nouveaux: nouveaux.sort(tri), dateModifiee: dateModifiee.sort(tri),
    dateConfirmee: dateConfirmee.sort(tri), annules: annules.sort(tri),
  };
}

// ─────────────────────────────────────────────────────────────
// Messages Teams (cartes adaptatives)
// ─────────────────────────────────────────────────────────────
const editeursTexte = (e) => e.editeurs.filter((n) => n !== '?' && norm(n) !== 'sans editeur').join(' / ');
function ligneEvent(e) {
  const morceaux = [dateCourte(e.date), `**${e.nom}**`, editeursTexte(e), e.format].filter(Boolean);
  return '• ' + morceaux.join(' — ') + (e.dateWarning ? ' — ⚠ À confirmer' : '');
}

const tb = (text, extra = {}) => ({ type: 'TextBlock', text, wrap: true, ...extra });
const titreSection = (text) => tb(text, { weight: 'Bolder', size: 'Medium', spacing: 'Large' });

function carte(body, actions = []) {
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard', version: '1.4', msteams: { width: 'Full' },
        body, actions,
      },
    }],
  };
}

function carteRecap(events, diff, today) {
  const body = [tb(`${CONFIG.textes.titre} — mise à jour du ${dateLongue(today)}`, { weight: 'Bolder', size: 'Large' })];

  if (diff) {
    const lignes = [
      ...diff.nouveaux.map((e) => 'Nouvel event : ' + ligneEvent(e).slice(2)),
      ...diff.dateModifiee.map((e) => `Date modifiée : **${e.nom}** — ${dateCourte(e.ancienneDate)} → ${dateCourte(e.date)}`),
      ...diff.dateConfirmee.map((e) => `Date confirmée : **${e.nom}** — ${dateCourte(e.date)}`),
      ...diff.annules.map((e) => `Annulé : **${e.nom}** — ${dateCourte(e.date)}`),
    ];
    if (lignes.length) {
      body.push(titreSection(`Nouveautés depuis le ${premier(fmt(diff.depuis, { day: 'numeric', month: 'long' }))}`));
      lignes.forEach((l) => body.push(tb('• ' + l, { spacing: 'Small' })));
    }
  }

  const fin = ajouterMois(today, CONFIG.horizonMois);
  const aVenir = events.filter((e) => e.date >= today && e.date <= fin);
  if (!aVenir.length) {
    body.push(titreSection('À venir'));
    body.push(tb(CONFIG.textes.rienAVenir));
  } else {
    let mois = '';
    for (const e of aVenir) {
      const m = moisAnnee(e.date);
      if (m !== mois) { body.push(titreSection(`À venir — ${m}`)); mois = m; }
      body.push(tb(ligneEvent(e), { spacing: 'Small' }));
    }
  }

  body.push(tb(CONFIG.textes.rappelSF, { spacing: 'Large', isSubtle: true }));
  return carte(body, [{ type: 'Action.OpenUrl', title: CONFIG.textes.bouton, url: CONFIG.calendrierUrl }]);
}

function lignesAlerte(events, problemes, today) {
  const lignes = [];
  for (const e of events.filter((x) => x.dateWarning && x.date < today)) {
    lignes.push(`• [${e.nom}](${e.url}) — date dépassée (${dateCourte(e.date)}), toujours « à confirmer »`);
  }
  const vus = new Set();
  for (const p of problemes) {
    const cle = p.type + p.url;
    if (vus.has(cle)) continue;
    vus.add(cle);
    if (p.type === 'sansDate') lignes.push(`• [${p.nom}](${p.url}) — pas de date de fin, absent du calendrier`);
    if (p.type === 'editeur') lignes.push(`• [${p.nom}](${p.url}) — éditeur illisible (vérifier l'accès de la connexion à la base Partenaires)`);
  }
  return lignes;
}

function carteAlerte(lignes) {
  return carte([
    tb('À mettre à jour dans Notion', { weight: 'Bolder', size: 'Large' }),
    ...lignes.map((l) => tb(l, { spacing: 'Small' })),
  ]);
}

async function poster(urlEnv, payload) {
  const url = env(urlEnv);
  if (!url) throw new Error(`Secret ${urlEnv} manquant`);
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`Envoi Teams (${urlEnv}) refusé : ${res.status} ${await res.text()}`);
}

// Aperçu lisible dans le résumé GitHub (mode test)
function apercu(payload) {
  const c = payload.attachments[0].content;
  const lignes = c.body.map((b) => (b.weight === 'Bolder' ? `\n**${b.text}**` : b.text));
  if (c.actions?.length) lignes.push(`\n[${c.actions[0].title}](${c.actions[0].url})`);
  return lignes.join('\n');
}
async function resume(texte) {
  console.log(texte);
  if (env('GITHUB_STEP_SUMMARY')) await fs.appendFile(env('GITHUB_STEP_SUMMARY'), texte + '\n\n');
}

// ─────────────────────────────────────────────────────────────
// Programme
// ─────────────────────────────────────────────────────────────
async function main() {
  const mode = env('MODE') || 'test'; // auto | test | envoi-sales | envoi-alerte
  const today = env('DATE_FORCEE') || aujourdhuiParis();
  const annee = Number(today.slice(0, 4));
  if (!env('NOTION_TOKEN')) throw new Error('Secret NOTION_TOKEN manquant');
  await fs.mkdir('state', { recursive: true });

  const problemes = [];
  const tous = [];
  for (const source of CONFIG.sources) {
    for (const page of await lirePagesSource(source)) {
      const ev = await versEvent(page, problemes);
      if (ev) tous.push(avecStatut(ev, today));
    }
  }
  tous.sort((a, b) => a.date.localeCompare(b.date) || a.nom.localeCompare(b.nom, 'fr'));

  // Calendrier : année en cours + année suivante
  const fenetre = tous.filter((e) => [annee, annee + 1].includes(Number(e.date.slice(0, 4))));
  const anneePrec = annee - 1;
  const totalPrec = anneePrec >= CONFIG.premiereAnnee
    ? tous.filter((e) => Number(e.date.slice(0, 4)) === anneePrec && !e.dateWarning).length
    : null;

  await ecrireJson('data.json', {
    genereLe: new Date().toISOString(),
    aujourdhui: today,
    anneeEnCours: annee,
    anneeSuivante: annee + 1,
    anneePrecedente: { annee: anneePrec, total: totalPrec },
    events: fenetre.map(({ url, ...e }) => e),
  });

  // Récap sales
  const dernier = await lireJson('state/dernier-envoi.json', null);
  const diff = differences(dernier, fenetre, today);
  const recap = carteRecap(fenetre, diff, today);
  const envoyerSales = mode === 'envoi-sales' || (mode === 'auto' && estJourEnvoi(today));

  // Alerte personnelle
  const alerte = lignesAlerte(fenetre, problemes, today);
  const envoyerAlerte = alerte.length > 0 && (mode === 'auto' || mode === 'envoi-alerte');

  await resume(`## Données\n${fenetre.length} events dans le calendrier (${annee}–${annee + 1}).`);
  await resume(`## Récap sales — ${envoyerSales ? 'ENVOYÉ' : 'aperçu, non envoyé'}\n${apercu(recap)}`);
  await resume(`## Alerte personnelle — ${alerte.length ? (envoyerAlerte ? 'ENVOYÉE' : 'aperçu, non envoyée') : 'rien à signaler'}\n${alerte.join('\n')}`);

  if (envoyerSales) {
    await poster('TEAMS_WEBHOOK_URL', recap);
    await ecrireJson('state/dernier-envoi.json', { date: today, events: fenetre.map(({ id, nom, date, dateWarning }) => ({ id, nom, date, dateWarning })) });
  }
  if (envoyerAlerte) await poster('TEAMS_ALERT_WEBHOOK_URL', carteAlerte(alerte));

  await ecrireJson('state/dernier-passage.json', { date: new Date().toISOString(), mode });
}

main().catch(async (e) => {
  console.error(e);
  // Prévenir Christel si le script plante (token expiré, base non partagée…)
  try {
    if (env('TEAMS_ALERT_WEBHOOK_URL')) {
      await poster('TEAMS_ALERT_WEBHOOK_URL', carteAlerte([`• La mise à jour automatique du calendrier a échoué : ${e.message}`]));
    }
  } catch { /* rien */ }
  process.exit(1);
});
