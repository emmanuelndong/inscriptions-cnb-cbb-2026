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
  const ident = authFromReq(req) ||
    (((req.headers['x-admin-key'] || req.query.key) === process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD)
      ? { role: 'national', region: null } : null);

  if (!ident) { res.status(401).json({ ok: false, error: 'Non autorisé' }); return; }

  try {
    let rows;
    if (ident.role === 'national') {
      rows = await sql`SELECT * FROM inscriptions ORDER BY created_at DESC`;
    } else {
      rows = await sql`SELECT * FROM inscriptions WHERE region = ${ident.region} ORDER BY created_at DESC`;
    }
    res.status(200).json({ ok: true, rows, role: ident.role, region: ident.region });
  } catch (err) {
    res.status(200).json({ ok: true, rows: [], role: ident.role, region: ident.region });
  }
}
