import { neon } from '@neondatabase/serverless';

const CONN =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_PRISMA_URL;

const sql = neon(CONN);

const clean = s => (s || '').toString().trim().toUpperCase();

export default async function handler(req, res) {
  const ref = clean(req.query.ref || (req.body && req.body.ref));
  if (!ref) { res.status(400).json({ ok: false, error: 'Référence manquante' }); return; }
  try {
    const rows = await sql`
      SELECT nom, prenoms, camp, statut, signed_url, motif
      FROM inscriptions
      WHERE UPPER(ref) = ${ref}
      ORDER BY created_at DESC
      LIMIT 1`;
    if (!rows.length) { res.status(200).json({ ok: true, found: false }); return; }
    const r = rows[0];
    res.status(200).json({
      ok: true, found: true,
      nom: r.nom, prenoms: r.prenoms, camp: r.camp,
      statut: r.statut || 'en_attente',
      motif: r.motif || '',
      hasFile: !!r.signed_url
    });
  } catch (err) {
    res.status(200).json({ ok: true, found: false, note: 'error' });
  }
}
