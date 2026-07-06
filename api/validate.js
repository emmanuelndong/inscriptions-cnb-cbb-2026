import { neon } from '@neondatabase/serverless';
import { authFromReq } from './login.js';

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

  const ident = authFromReq(req);
  if (!ident) { res.status(401).json({ ok: false, error: 'Non autorisé' }); return; }

  let d = req.body;
  try {
    if (Buffer.isBuffer(d)) d = d.toString('utf8');
    if (typeof d === 'string') d = JSON.parse(d);
  } catch (e) { d = {}; }
  d = d || {};

  const ref = clean(d.ref).toUpperCase();
  const action = clean(d.action);              // 'valider_crca' | 'valider_final' | 'rejeter'
  const motif = clean(d.motif).slice(0, 300);
  if (!ref || !['valider_crca', 'valider_final', 'rejeter'].includes(action)) {
    res.status(400).json({ ok: false, error: 'Requête invalide' }); return;
  }

  try {
    const found = await sql`SELECT region, statut FROM inscriptions WHERE UPPER(ref) = ${ref} ORDER BY created_at DESC LIMIT 1`;
    if (!found.length) { res.status(404).json({ ok: false, error: 'Inscription introuvable' }); return; }
    const row = found[0];

    // un CRCA ne peut agir que sur SA région
    if (ident.role === 'crca' && row.region !== ident.region) {
      res.status(403).json({ ok: false, error: 'Hors de votre région' }); return;
    }
    // la validation finale est réservée au national
    if (action === 'valider_final' && ident.role !== 'national') {
      res.status(403).json({ ok: false, error: 'Validation finale réservée au national' }); return;
    }

    if (action === 'valider_crca') {
      await sql`UPDATE inscriptions SET statut = 'validee_crca', motif = NULL WHERE UPPER(ref) = ${ref}`;
    } else if (action === 'valider_final') {
      // la validation finale exige une validation CRCA préalable
      if (row.statut !== 'validee_crca') {
        res.status(409).json({ ok: false, error: "Doit d'abord être validée par le CRCA de la région." }); return;
      }
      await sql`UPDATE inscriptions SET statut = 'validee', motif = NULL WHERE UPPER(ref) = ${ref}`;
    } else { // rejeter
      await sql`UPDATE inscriptions SET statut = 'rejetee', motif = ${motif || 'Non conforme'} WHERE UPPER(ref) = ${ref}`;
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
}
