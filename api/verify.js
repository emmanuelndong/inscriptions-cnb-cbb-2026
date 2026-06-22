// Vérifie qu'un candidat figure dans la base des assurés (Google Sheets publié en CSV).
// Clé : N° d'assurance + Nom + Prénom + Date de naissance. Lieu de naissance ignoré.
//
// Configuration : variable d'environnement INSURANCE_CSV_URL = l'URL CSV publiée du Sheet.
//   (Sheet → Fichier → Partager → Publier sur le web → onglet concerné → CSV)
//
// Comportement « fail-open » sur problème d'infra : si l'URL n'est pas configurée,
// ou si la source est injoignable / mal structurée, on NE bloque PAS (ok:true).
// On ne bloque (ok:false) que si la liste a bien été lue et que la personne n'y figure pas.

let CACHE = { t: 0, rows: null };
const TTL = 5 * 60 * 1000; // 5 min

const norm = s => (s == null ? '' : s.toString())
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/\s+/g, ' ').trim();
const normNum = s => norm(s).replace(/\s/g, '');
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

function numbersEqual(a, b) {
  a = normNum(a); b = normNum(b);
  if (a === b) return true;
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return Number(a) === Number(b);
  return false;
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

async function getInsured() {
  const url = process.env.INSURANCE_CSV_URL;
  if (!url) return { status: 'unconfigured' };
  if (CACHE.rows && Date.now() - CACHE.t < TTL) return { status: 'ok', rows: CACHE.rows };
  try {
    const res = await fetch(url);
    if (!res.ok) return { status: 'source_error' };
    const text = await res.text();
    const rows = parseCSV(text);
    CACHE = { t: Date.now(), rows };
    return { status: 'ok', rows };
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

    const src = await getInsured();
    // fail-open : on ne bloque pas si la source n'est pas exploitable
    if (src.status !== 'ok') { res.status(200).json({ ok: true, note: src.status }); return; }

    const rows = src.rows;
    if (!rows || rows.length < 2) { res.status(200).json({ ok: true, note: 'empty_source' }); return; }

    const H = rows[0];
    const iAss = findCol(H, h => /(ASSUR|POLICE|MATRICULE|ADHESION|ADHERENT)/.test(h)) ;
    const iPre = findCol(H, h => /PRENOM/.test(h));
    const iNom = findCol(H, h => /NOM/.test(h) && !/PRENOM/.test(h));
    const iDob = findCol(H, h => /NAISS/.test(h)) >= 0 ? findCol(H, h => /NAISS/.test(h)) : findCol(H, h => /DATE/.test(h));

    // colonnes clés introuvables -> on ne bloque pas, mais on signale
    if (iAss < 0 || iNom < 0) { res.status(200).json({ ok: true, note: 'columns_not_found' }); return; }

    const wantAss = d.assurance, wantNom = norm(d.nom), wantPre = norm(d.prenoms), wantDob = canonDate(d.naissance);

    let numberFound = false, matched = false;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;
      if (!numbersEqual(row[iAss], wantAss)) continue;
      numberFound = true;

      const rowNom = norm(row[iNom]);
      const nomOk = !rowNom || rowNom === wantNom || rowNom.includes(wantNom) || wantNom.includes(rowNom);

      let preOk = true;
      if (iPre >= 0) {
        const rowPre = norm(row[iPre]);
        if (rowPre && wantPre) {
          const t1 = wantPre.split(' ')[0], t2 = rowPre.split(' ')[0];
          preOk = rowPre === wantPre || rowPre.includes(t1) || wantPre.includes(t2) || t1 === t2;
        }
      }

      let dobOk = true;
      if (iDob >= 0) {
        const rowDob = canonDate(row[iDob]);
        if (rowDob && wantDob) dobOk = rowDob === wantDob;
      }

      if (nomOk && preOk && dobOk) { matched = true; break; }
    }

    if (matched) { res.status(200).json({ ok: true }); return; }
    if (numberFound) { res.status(200).json({ ok: false, reason: 'mismatch' }); return; } // n° trouvé mais identité différente
    res.status(200).json({ ok: false, reason: 'not_insured' });
  } catch (err) {
    // en cas d'erreur interne, ne pas bloquer les inscriptions
    res.status(200).json({ ok: true, note: 'error' });
  }
}
