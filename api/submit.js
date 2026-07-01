import { neon } from '@neondatabase/serverless';

const CONN =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_PRISMA_URL;

const sql = neon(CONN);

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

    await ensureTable();

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
