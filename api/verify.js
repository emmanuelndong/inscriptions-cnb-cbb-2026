// Vérifie qu'un candidat figure dans la base des assurés (Google Sheets publié en CSV).
// Clé : N° d'assurance + Nom + Prénom + Date de naissance. Lieu de naissance ignoré.
//
// Configuration : variable d'environnement INSURANCE_CSV_URL = l'URL CSV publiée du Sheet.
//   (Sheet → Fichier → Partager → Publier sur le web → onglet concerné → CSV)
//
// Performance : la feuille est lue une seule fois puis mise en cache (5 min), et un index
// par numéro d'assurance est construit -> recherche instantanée même avec des milliers de lignes.
//
// « Fail-open » sur problème d'infra : si l'URL n'est pas configurée, source injoignable ou
// colonnes introuvables, on NE bloque PAS (ok:true). On bloque (ok:false) seulement si la liste
// a bien été lue et que la personne n'y figure pas (ou que le numéro correspond à une autre identité).

let CACHE = { t: 0, idx: null };
const TTL = 5 * 60 * 1000; // 5 min

const norm = s => (s == null ? '' : s.toString())
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/['’`´]/g, '')          // apostrophes -> rien  (N'DIAYE -> NDIAYE)
  .replace(/[-_.]/g, ' ')          // tirets/points -> espace (MARIE-CLAIRE -> MARIE CLAIRE)
  .replace(/[^A-Z0-9 ]/g, ' ')     // tout autre symbole -> espace
  .replace(/\s+/g, ' ').trim();
const normNum = s => norm(s).replace(/\s/g, '');
// clé tolérante aux zéros de tête : "0012345" et "12345" -> "12345"
const keyOf = s => { const n = normNum(s); return /^\d+$/.test(n) ? String(Number(n)) : n; };
const pad2 = s => ('0' + s).slice(-2);

function canonDate(s) {
  if (!s) return '';
  s = s.toString().trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);            // YYYY-MM-DD
  if (m) return m[1] + pad2(m[2]) + pad2(m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);              // DD/MM/YYYY
  if (m) { let y = m[3]; if (y.length === 2) y = (Number(y) > 30 ? '19' : '20') + y; return y + pad2(m[2]) + pad2(m[1]); }
  return s.replace(/\D/g, '');
}

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

function findCol(H, pred) { for (let i = 0; i < H.length; i++) if (pred(norm(H[i]))) return i; return -1; }

function buildIndex(rows) {
  if (!rows || rows.length < 2) return { status: 'empty' };
  const H = rows[0];
  const iAss = findCol(H, h => /(ASSUR|POLICE|MATRICULE|ADHESION|ADHERENT)/.test(h));
  const iPre = findCol(H, h => /PRENOM/.test(h));
  const iNom = findCol(H, h => /NOM/.test(h) && !/PRENOM/.test(h));
  let iDob = findCol(H, h => /NAISS/.test(h));
  if (iDob < 0) iDob = findCol(H, h => /DATE/.test(h));
  if (iAss < 0 || iNom < 0) return { status: 'columns_not_found' };

  const map = new Map();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;
    const k = keyOf(row[iAss]);
    if (!k) continue;
    const rec = {
      nom: norm(row[iNom]),
      pre: iPre >= 0 ? norm(row[iPre]) : '',
      dob: iDob >= 0 ? canonDate(row[iDob]) : ''
    };
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(rec);
  }
  return { status: 'ok', map };
}

async function getIndex() {
  const url = process.env.INSURANCE_CSV_URL;
  if (!url) return { status: 'unconfigured' };
  if (CACHE.idx && Date.now() - CACHE.t < TTL) return CACHE.idx;
  try {
    const res = await fetch(url);
    if (!res.ok) return { status: 'source_error' };
    const text = await res.text();
    const idx = buildIndex(parseCSV(text));
    CACHE = { t: Date.now(), idx };
    return idx;
  } catch (e) {
    return { status: 'source_error' };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'Méthode non autorisée' }); return; }
  try {
    let d = req.body;
    if (Buffer.isBuffer(d)) d = d.toString('utf8');
    if (typeof d === 'string') d = JSON.parse(d);

    const idx = await getIndex();
    // fail-open si la source n'est pas exploitable
    if (idx.status !== 'ok') { res.status(200).json({ ok: true, note: idx.status }); return; }

    const recs = idx.map.get(keyOf(d.assurance));
    if (!recs) { res.status(200).json({ ok: false, reason: 'not_insured' }); return; }

    const wantNom = norm(d.nom), wantPre = norm(d.prenoms), wantDob = canonDate(d.naissance);
    for (const rec of recs) {
      const nomOk = !rec.nom || rec.nom === wantNom || rec.nom.includes(wantNom) || wantNom.includes(rec.nom);
      let preOk = true;
      if (rec.pre && wantPre) {
        const t1 = wantPre.split(' ')[0], t2 = rec.pre.split(' ')[0];
        preOk = rec.pre === wantPre || rec.pre.includes(t1) || wantPre.includes(t2) || t1 === t2;
      }
      const dobOk = !(rec.dob && wantDob) || rec.dob === wantDob;
      if (nomOk && preOk && dobOk) { res.status(200).json({ ok: true }); return; }
    }
    // numéro trouvé mais identité différente
    res.status(200).json({ ok: false, reason: 'mismatch' });
  } catch (err) {
    res.status(200).json({ ok: true, note: 'error' });
  }
}
