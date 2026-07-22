import { neon } from '@neondatabase/serverless';

const CONN =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_PRISMA_URL;

const sql = neon(CONN);

// clôture des inscriptions : 1er août 2026 00:00 (heure du Sénégal, UTC+0)
const DEADLINE = Date.parse('2026-08-01T00:00:00Z');

// normalisation du n° d'assurance (espaces, tirets, accents, casse, zéros de tête)
const normNum = s => (s == null ? '' : s.toString()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const keyOf = s => { const n = normNum(s); return /^\d+$/.test(n) ? String(Number(n)) : n; };

async function ensureTable() {
  await sql`CREATE TABLE IF NOT EXISTS inscriptions (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT now(),
    camp TEXT, nom TEXT, prenoms TEXT, naissance TEXT, lieu_naissance TEXT,
    niveau TEXT, religion TEXT, adresse TEXT, email TEXT, mobile TEXT, fixe TEXT,
    profession TEXT, societe TEXT, cni TEXT, cni_date TEXT, taille TEXT, assurance TEXT, medical TEXT, urgence TEXT,
    region TEXT, district TEXT, groupe TEXT, fonction TEXT, entree TEXT, promesse TEXT,
    struct JSONB, autre JSONB,
    ref TEXT, statut TEXT DEFAULT 'en_attente', signed_url TEXT, signed_at TIMESTAMPTZ
  )`;
  // au cas où la table existe déjà sans certaines colonnes
  await sql`ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS taille TEXT`;
  await sql`ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS assurance TEXT`;
  await sql`ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS ref TEXT`;
  await sql`ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS statut TEXT DEFAULT 'en_attente'`;
  await sql`ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS signed_url TEXT`;
  await sql`ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ`;
  await sql`ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS motif TEXT`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Méthode non autorisée' });
    return;
  }
  try {
    let d = req.body;
    if (Buffer.isBuffer(d)) d = d.toString('utf8');
    if (typeof d === 'string') d = JSON.parse(d);
    if (!d || typeof d !== 'object') {
      res.status(400).json({ ok: false, error: 'Données invalides' });
      return;
    }

    // inscriptions closes après la date limite
    if (Date.now() >= DEADLINE) {
      res.status(200).json({ ok: false, reason: 'closed', error: 'Les inscriptions sont closes depuis le 1er août 2026.' });
      return;
    }

    // le n° d'assurance doit être un numéro (au moins 4 chiffres)
    if (((d.assurance || '').toString().replace(/\D/g, '')).length < 4) {
      res.status(200).json({ ok: false, reason: 'bad_insurance', error: "Numéro d'assurance invalide (chiffres attendus)." });
      return;
    }

    await ensureTable();

    // --- gestion des doublons par n° d'assurance ---
    const want = keyOf(d.assurance);
    if (want) {
      const existing = await sql`SELECT id, assurance, statut, ref, created_at FROM inscriptions`;
      const matches = existing.filter(r => keyOf(r.assurance) === want);

      // déjà validé (CRCA ou finale) -> on bloque, on ne touche à rien
      if (matches.some(r => r.statut === 'validee' || r.statut === 'validee_crca')) {
        res.status(200).json({
          ok: false, reason: 'already_validated',
          error: 'Vous êtes déjà inscrit et votre dossier est validé. Contactez votre commissariat pour toute modification.'
        });
        return;
      }

      // sinon (en attente ou rejeté) -> on remplace la plus récente par la nouvelle inscription
      if (matches.length) {
        matches.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        const t = matches[0];
        await sql`
          UPDATE inscriptions SET
            camp=${d.camp}, nom=${d.nom}, prenoms=${d.prenoms}, naissance=${d.naissance}, lieu_naissance=${d.lieuNaissance},
            niveau=${d.niveau}, religion=${d.religion}, adresse=${d.adresse}, email=${d.email}, mobile=${d.mobile}, fixe=${d.fixe},
            profession=${d.profession}, societe=${d.societe}, cni=${d.cni}, cni_date=${d.cniDate}, taille=${d.taille}, assurance=${d.assurance},
            medical=${d.medical}, urgence=${d.urgence}, region=${d.region}, district=${d.district}, groupe=${d.groupe}, fonction=${d.fonction},
            entree=${d.entree}, promesse=${d.promesse}, struct=${JSON.stringify(d.struct || [])}, autre=${JSON.stringify(d.autre || [])},
            ref=${d.ref || t.ref || null}, statut='en_attente', motif=NULL, created_at=now()
          WHERE id=${t.id}`;
        res.status(200).json({ ok: true, id: t.id, replaced: true });
        return;
      }
    }

    const rows = await sql`
      INSERT INTO inscriptions
        (camp, nom, prenoms, naissance, lieu_naissance, niveau, religion, adresse, email,
         mobile, fixe, profession, societe, cni, cni_date, taille, assurance, medical, urgence,
         region, district, groupe, fonction, entree, promesse, struct, autre, ref, statut)
      VALUES
        (${d.camp}, ${d.nom}, ${d.prenoms}, ${d.naissance}, ${d.lieuNaissance}, ${d.niveau},
         ${d.religion}, ${d.adresse}, ${d.email}, ${d.mobile}, ${d.fixe}, ${d.profession},
         ${d.societe}, ${d.cni}, ${d.cniDate}, ${d.taille}, ${d.assurance}, ${d.medical}, ${d.urgence}, ${d.region},
         ${d.district}, ${d.groupe}, ${d.fonction}, ${d.entree}, ${d.promesse},
         ${JSON.stringify(d.struct || [])}, ${JSON.stringify(d.autre || [])}, ${d.ref || null}, 'en_attente')
      RETURNING id`;

    res.status(200).json({ ok: true, id: rows[0].id });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
}
