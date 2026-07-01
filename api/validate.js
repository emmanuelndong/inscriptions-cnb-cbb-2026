import { neon } from '@neondatabase/serverless';

const CONN =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_PRISMA_URL;

const sql = neon(CONN);
const clean = s => (s || '').toString().trim();

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'Méthode non autorisée' }); return; }

  let d = req.body;
  try {
    if (Buffer.isBuffer(d)) d = d.toString('utf8');
    if (typeof d === 'string') d = JSON.parse(d);
  } catch (e) { d = {}; }
  d = d || {};

  const key = req.headers['x-admin-key'] || d.key;
  if (!process.env.ADMIN_PASSWORD || key !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ ok: false, error: 'Non autorisé' }); return;
  }

  const ref = clean(d.ref).toUpperCase();
  const action = clean(d.action);
  const motif = clean(d.motif).slice(0, 300);
  if (!ref || !['valider', 'rejeter'].includes(action)) {
    res.status(400).json({ ok: false, error: 'Requête invalide' }); return;
  }

  try {
    if (action === 'valider') {
      await sql`UPDATE inscriptions SET statut = 'validee', motif = NULL WHERE UPPER(ref) = ${ref}`;
    } else {
      await sql`UPDATE inscriptions SET statut = 'rejetee', motif = ${motif || 'Fiche non conforme'} WHERE UPPER(ref) = ${ref}`;
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
}
