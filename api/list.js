import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (!process.env.ADMIN_PASSWORD || key !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ ok: false, error: 'Non autorisé' });
    return;
  }
  try {
    const rows = await sql`SELECT * FROM inscriptions ORDER BY created_at DESC`;
    res.status(200).json({ ok: true, rows });
  } catch (err) {
    // table pas encore créée (aucune inscription) → liste vide
    res.status(200).json({ ok: true, rows: [] });
  }
}
