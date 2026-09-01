# Sri Sri Sathya Sai Automobiles — Production POS

Offline-first PWA for counter billing, inventory, purchases, and owner analytics.

## Stack

- **Frontend:** Vite + React + Tailwind CSS 4 + PWA (`vite-plugin-pwa`)
- **Local DB:** Dexie (IndexedDB) + FlexSearch
- **Backend:** Supabase (PostgreSQL, Auth, Realtime)

## Quick start

```bash
cd frontend
cp .env.example .env   # add your Supabase URL + anon key
npm install
npm run dev
```

Open http://localhost:5173 — use **Continue in demo mode** without Supabase, or sign in with owner/staff accounts.

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com)
2. Run migrations in SQL editor (order matters):
   - `supabase/migrations/001_initial_schema.sql`
   - `supabase/migrations/002_rls_policies.sql`
3. Create Auth users (Authentication → Users):
   - Owner: set user metadata `role` = `owner` (or update `profiles` after signup)
   - Staff: default role `staff`
4. Copy **Project URL** and **anon key** into `frontend/.env`

## Deploy (Vercel)

- Root directory: `frontend`
- Build: `npm run build`
- Output: `dist`
- Add env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`

## Features (v1)

- White + charcoal UI, logo branding
- One OPEN register session per IST calendar day
- POS: name/code search, discounts (staff max 20%), Cash/UPI/Credit
- Customer auto-save by phone
- Owner dashboard: valuation, profit, register audit
- Inventory CRUD, manual purchases, Excel import (Kumar/Gayatri/Kokila)
- Owner prompt when inward cost changes
- Offline sale queue + sync on reconnect
- 80mm receipt print

## Folder layout

```text
satya-sai-pos/
├── frontend/          # Vite React PWA
└── supabase/migrations/
```

`satya-sai-auto` is the reference prototype — not modified by this project.
