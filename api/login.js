// Connexion multi-comptes : 1 national + 6 CRCA (un par région).
// Les mots de passe sont dans des variables d'environnement (aucun mot de passe en clair dans le code) :
//   ADMIN_PASSWORD               -> compte national (toi)
//   CRCA_CASAMANCE_PASSWORD      -> CRCA Casamance
//   CRCA_DAKAR_PASSWORD          -> CRCA Dakar
//   CRCA_FLEUVE_PASSWORD         -> CRCA Fleuve
//   CRCA_KAOLACK_PASSWORD        -> CRCA Kaolack
//   CRCA_PETITECOTE_PASSWORD     -> CRCA Petite Côte
//   CRCA_THIES_PASSWORD          -> CRCA Thiès

export const ACCOUNTS = [
  { user: 'national',        role: 'national', region: null,          env: 'ADMIN_PASSWORD',            label: 'National (validation finale)' },
  { user: 'crca-casamance',  role: 'crca',     region: 'Casamance',   env: 'CRCA_CASAMANCE_PASSWORD',   label: 'CRCA — Casamance' },
  { user: 'crca-dakar',      role: 'crca',     region: 'Dakar',       env: 'CRCA_DAKAR_PASSWORD',       label: 'CRCA — Dakar' },
  { user: 'crca-fleuve',     role: 'crca',     region: 'Fleuve',      env: 'CRCA_FLEUVE_PASSWORD',      label: 'CRCA — Fleuve' },
  { user: 'crca-kaolack',    role: 'crca',     region: 'Kaolack',     env: 'CRCA_KAOLACK_PASSWORD',     label: 'CRCA — Kaolack' },
  { user: 'crca-petitecote', role: 'crca',     region: 'Petite Côte', env: 'CRCA_PETITECOTE_PASSWORD',  label: 'CRCA — Petite Côte' },
  { user: 'crca-thies',      role: 'crca',     region: 'Thiès',       env: 'CRCA_THIES_PASSWORD',       label: 'CRCA — Thiès' },
];

export function identify(user, key) {
  user = (user || '').toString();
  key = (key || '').toString();
  if (!key) return null;
  const acc = ACCOUNTS.find(a => a.user === user);
  if (acc) {
    const p = process.env[acc.env];
    if (p && key === p) return { user: acc.user, role: acc.role, region: acc.region };
    return null;
  }
  // rétro-compatibilité : ADMIN_PASSWORD sans nom d'utilisateur = national
  if (process.env.ADMIN_PASSWORD && key === process.env.ADMIN_PASSWORD) {
    return { user: 'national', role: 'national', region: null };
  }
  return null;
}

export function authFromReq(req) {
  return identify(req.headers['x-user'], req.headers['x-key'] || req.headers['x-admin-key']);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'Méthode non autorisée' }); return; }
  let d = req.body;
  try {
    if (Buffer.isBuffer(d)) d = d.toString('utf8');
    if (typeof d === 'string') d = JSON.parse(d || '{}');
  } catch (e) { d = {}; }
  d = d || {};
  const ident = identify(d.user, d.pass);
  if (!ident) { res.status(401).json({ ok: false, error: 'Identifiants invalides' }); return; }
  res.status(200).json({ ok: true, ...ident });
}
