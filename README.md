# Inscriptions Camp CNB / CBB 2026 — Vercel + Neon

Registre central des inscriptions : un formulaire public + une base Postgres + une page d'admin.
Tout est gratuit (plan Hobby de Vercel + free tier Neon), sur tes comptes personnels.

## Contenu

```
vercel-cnb-cbb/
├── index.html        → le formulaire public (envoie vers /api/submit)
├── admin.html        → tableau de bord d'admin (liste, filtres, CSV, ré-impression)
├── api/
│   ├── submit.js     → reçoit une inscription et l'écrit dans Neon
│   └── list.js       → renvoie toutes les inscriptions (protégé par mot de passe)
├── package.json      → dépendance @neondatabase/serverless
└── README.md
```

## Déploiement (≈ 10 min)

### 1. Pousser le projet sur Vercel
Deux options :
- **Git** : crée un dépôt (GitHub/GitLab), pousse ce dossier, puis « New Project » sur vercel.com et importe le dépôt.
- **CLI** : `npm i -g vercel`, puis dans le dossier : `vercel` (suis les questions).

À l'import, Vercel détecte un projet « Other » : pas de build, il sert `index.html`/`admin.html`
en statique et `api/*.js` comme fonctions serverless. Laisse les réglages par défaut.

### 2. Créer la base Neon et la connecter
- Dans le projet Vercel : onglet **Storage → Create Database → Neon (Postgres)**.
- Suis l'assistant (crée un compte Neon si besoin). Une fois connectée, Vercel ajoute
  automatiquement la variable d'environnement **`DATABASE_URL`** au projet.
- La table `inscriptions` se crée toute seule à la première inscription (aucune migration à lancer).

### 3. Définir le mot de passe d'admin
- Projet Vercel → **Settings → Environment Variables** → ajoute :
  - **Nom** : `ADMIN_PASSWORD`
  - **Valeur** : un mot de passe de ton choix
- **Redéploie** (onglet Deployments → ⋯ → Redeploy) pour que les variables soient prises en compte.

### 4. Utiliser
- **Formulaire public** : `https://<ton-projet>.vercel.app/`
- **Admin** : `https://<ton-projet>.vercel.app/admin.html` (entre le mot de passe défini à l'étape 3)

## Comment ça marche
- Chaque inscription validée part en POST vers `/api/submit`, qui l'insère dans Neon.
- Si l'envoi échoue (réseau), l'inscription reste enregistrée **localement** dans le navigateur
  du candidat et un message le signale — rien n'est perdu.
- La page d'admin lit toutes les inscriptions, permet de filtrer (camp / région / district / recherche),
  d'exporter en CSV, et de **ré-imprimer chaque fiche officielle** à l'identique.

## Notes
- **Sécurité** : la protection de l'admin est un simple mot de passe partagé (transmis en HTTPS).
  Suffisant pour un usage interne ; ne publie pas l'URL d'admin.
- **Veille Neon (free tier)** : après une période d'inactivité, la base se met en veille ;
  la première requête prend ~½ seconde puis redevient instantanée.
- **Domaine perso** : tu peux brancher un domaine dans Vercel → Settings → Domains
  (ex. `inscriptions.tondomaine.sn`).
- **Sauvegarde** : depuis la console Neon ou via l'export CSV de l'admin.
```
```
