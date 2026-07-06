import { neon } from '@neondatabase/serverless';
import { authFromReq } from './login.js';

const CONN =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_PRISMA_URL;

const sql = neon(CONN);

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'Méthode non autorisée' }); return; }
  const ident = authFromReq(req);
  if (!ident || ident.role !== 'national') { res.status(401).json({ ok: false, error: 'Non autorisé' }); return; }
  try {
    const c = await sql`SELECT COUNT(*)::int AS n FROM inscriptions`;
    await sql`DELETE FROM inscriptions`;
    res.status(200).json({ ok: true, deleted: c[0].n });
  } catch (err) {
    res.status(200).json({ ok: true, deleted: 0, note: 'no_table' });
  }
}
