import { neon } from '@neondatabase/serverless';

const CONN =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_PRISMA_URL;

const sql = neon(CONN);

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'Méthode non autorisée' }); return; }

  // mot de passe admin via header (ou corps)
  let key = req.headers['x-admin-key'];
  if (!key) {
    try {
      let d = req.body;
      if (Buffer.isBuffer(d)) d = d.toString('utf8');
      if (typeof d === 'string' && d) d = JSON.parse(d);
      if (d && typeof d === 'object') key = d.key;
    } catch (e) { /* ignore */ }
  }
  if (!process.env.ADMIN_PASSWORD || key !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ ok: false, error: 'Non autorisé' });
    return;
  }

  try {
    const c = await sql`SELECT COUNT(*)::int AS n FROM inscriptions`;
    await sql`DELETE FROM inscriptions`;
    res.status(200).json({ ok: true, deleted: c[0].n });
  } catch (err) {
    // table inexistante = déjà vide
    res.status(200).json({ ok: true, deleted: 0, note: 'no_table' });
  }
}
