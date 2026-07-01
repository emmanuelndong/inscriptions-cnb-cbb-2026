import { neon } from '@neondatabase/serverless';
import { put } from '@vercel/blob';

const CONN =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_PRISMA_URL;

const sql = neon(CONN);

const ALLOWED = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES = 8 * 1024 * 1024; // 8 Mo (le corps de requête reste limité par Vercel ~4,5 Mo)
const clean = s => (s || '').toString().trim();
const safe = s => clean(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'fiche';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'Méthode non autorisée' }); return; }
  try {
    let d = req.body;
    if (Buffer.isBuffer(d)) d = d.toString('utf8');
    if (typeof d === 'string') d = JSON.parse(d);
    if (!d || typeof d !== 'object') { res.status(400).json({ ok: false, error: 'Requête invalide' }); return; }

    const ref = clean(d.ref).toUpperCase();
    if (!ref) { res.status(400).json({ ok: false, error: 'Référence manquante' }); return; }

    const ct = clean(d.contentType);
    const ext = ALLOWED[ct];
    if (!ext) { res.status(400).json({ ok: false, error: 'Format non accepté (PDF, JPG ou PNG uniquement)' }); return; }

    const b64 = (d.data || '').toString().replace(/^data:[^,]*,/, '');
    let buf;
    try { buf = Buffer.from(b64, 'base64'); } catch (e) { res.status(400).json({ ok: false, error: 'Fichier illisible' }); return; }
    if (!buf.length) { res.status(400).json({ ok: false, error: 'Fichier vide' }); return; }
    if (buf.length > MAX_BYTES) { res.status(413).json({ ok: false, error: 'Fichier trop lourd' }); return; }

    // l'inscription existe-t-elle ?
    const found = await sql`SELECT id, nom FROM inscriptions WHERE UPPER(ref) = ${ref} ORDER BY created_at DESC LIMIT 1`;
    if (!found.length) { res.status(404).json({ ok: false, error: 'Référence introuvable' }); return; }

    if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
      res.status(500).json({ ok: false, error: 'Stockage non configuré (Vercel Blob).' }); return;
    }

    const path = `fiches-signees/${ref}-${Date.now()}-${safe(found[0].nom)}.${ext}`;
    const blob = await put(path, buf, { access: 'public', contentType: ct, addRandomSuffix: false });

    await sql`
      UPDATE inscriptions
      SET signed_url = ${blob.url}, statut = 'definitive', signed_at = now()
      WHERE UPPER(ref) = ${ref}`;

    res.status(200).json({ ok: true, url: blob.url });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
}
