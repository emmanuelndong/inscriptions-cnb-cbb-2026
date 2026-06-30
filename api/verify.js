// Vérifie qu'un candidat figure dans la base des assurés (plusieurs Google Sheets exportés en CSV).
// Adapté à la structure réelle des feuilles "ÉTAT NOMINATIF" des Scouts du Sénégal :
//   - quelques lignes de titre + vides AVANT l'en-tête (détection auto de la ligne d'en-tête) ;
//   - colonnes repérées par NOM (et non par position, qui varie d'une région à l'autre) ;
//   - numéro = colonne "Numéro Carte".
// Clé de correspondance : N° Carte + Nom + Prénom. (La date "Date et Lieu de Naissance" est trop
// irrégulière — texte/chiffres + lieu — donc non bloquante, pour éviter les faux rejets.)
//
// Config : INSURANCE_CSV_URL = une ou plusieurs URLs CSV, séparées par des virgules.
//   (lien d'édition -> remplacer /edit?... par /export?format=csv  ;  partage = "tout le monde avec le lien")
//
// Fail-open de sécurité : rien configuré / aucune source lisible / une partie en panne -> ne bloque pas.

let CACHE = { t: 0, idx: null };
const TTL = 5 * 60 * 1000;

const norm = s => (s == null ? '' : s.toString())
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/['’`´]/g, '')
  .replace(/[-_.]/g, ' ')
  .replace(/[^A-Z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ').trim();
const normNum = s => norm(s).replace(/\s/g, '');
const keyOf = s => { const n = normNum(s); return /^\d+$/.test(n) ? String(Number(n)) : n; };

function parseCSV(text) {
  const rows = []; let row = [], field = '', i = 0, q = false;
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
    i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const isNumCol = h => /(CARTE|ASSUR|POLICE|MATRICULE|ADHESION|ADHERENT)/.test(h);
const isNomCol = h => /NOM/.test(h) && !/PRENOM/.test(h);
const isPreCol = h => /PRENOM/.test(h);
function findCol(H, pred) { for (let i = 0; i < H.length; i++) if (pred(norm(H[i]))) return i; return -1; }

// Trouve la ligne d'en-tête (celle qui contient à la fois une colonne Nom et une colonne Numéro)
function detectHeaderRow(rows) {
  const lim = Math.min(rows.length, 40);
  for (let i = 0; i < lim; i++) {
    const H = rows[i] || [];
    const hasNom = H.some(c => isNomCol(norm(c)));
    const hasNum = H.some(c => isNumCol(norm(c)));
    if (hasNom && hasNum) return i;
  }
  return -1;
}

function buildMap(rows) {
  const hr = detectHeaderRow(rows);
  if (hr < 0) return { ok: false, reason: 'columns' };
  const H = rows[hr];
  const iAss = findCol(H, isNumCol);
  const iNom = findCol(H, isNomCol);
  const iPre = findCol(H, isPreCol);
  if (iAss < 0 || iNom < 0) return { ok: false, reason: 'columns' };

  const map = new Map();
  for (let r = hr + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;
    const k = keyOf(row[iAss]);
    if (!k) continue;
    const rec = { nom: norm(row[iNom]), pre: iPre >= 0 ? norm(row[iPre]) : '' };
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(rec);
  }
  return { ok: true, map };
}

async function getIndex() {
  const raw = process.env.INSURANCE_CSV_URL;
  if (!raw) return { status: 'unconfigured' };
  if (CACHE.idx && Date.now() - CACHE.t < TTL) return CACHE.idx;

  const urls = raw.split(/[\s,]+/).map(u => u.trim()).filter(Boolean);
  if (!urls.length) return { status: 'unconfigured' };

  const results = await Promise.allSettled(urls.map(async u => {
    const res = await fetch(u, { redirect: 'follow' });
    if (!res.ok) throw new Error('http ' + res.status);
    return parseCSV(await res.text());
  }));

  const map = new Map();
  let loaded = 0, failed = 0;
  for (const r of results) {
    if (r.status !== 'fulfilled') { failed++; continue; }
    const b = buildMap(r.value);
    if (!b.ok) { failed++; continue; }
    loaded++;
    for (const [k, arr] of b.map) {
      if (!map.has(k)) map.set(k, []);
      for (const rec of arr) map.get(k).push(rec);
    }
  }

  if (loaded === 0) return { status: 'source_error' };
  const idx = { status: 'ok', map, partial: failed > 0 };
  CACHE = { t: Date.now(), idx };
  return idx;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'Méthode non autorisée' }); return; }
  try {
    let d = req.body;
    if (Buffer.isBuffer(d)) d = d.toString('utf8');
    if (typeof d === 'string') d = JSON.parse(d);

    const idx = await getIndex();
    if (idx.status !== 'ok') { res.status(200).json({ ok: true, note: idx.status }); return; }

    const recs = idx.map.get(keyOf(d.assurance));
    if (recs) {
      const wantNom = norm(d.nom), wantPre = norm(d.prenoms);
      for (const rec of recs) {
        const nomOk = !rec.nom || rec.nom === wantNom || rec.nom.includes(wantNom) || wantNom.includes(rec.nom);
        let preOk = true;
        if (rec.pre && wantPre) {
          const t1 = wantPre.split(' ')[0], t2 = rec.pre.split(' ')[0];
          preOk = rec.pre === wantPre || rec.pre.includes(t1) || wantPre.includes(t2) || t1 === t2;
        }
        if (nomOk && preOk) { res.status(200).json({ ok: true }); return; }
      }
      res.status(200).json({ ok: false, reason: 'mismatch' }); return;
    }

    if (idx.partial) { res.status(200).json({ ok: true, note: 'partial_sources' }); return; }
    res.status(200).json({ ok: false, reason: 'not_insured' });
  } catch (err) {
    res.status(200).json({ ok: true, note: 'error' });
  }
}
