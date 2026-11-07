# Warehouse Logger

Warehouse inventory and point-of-sale app built with Vite, TypeScript, Three.js, Tailwind CSS, and Supabase. Supabase provides authentication and database persistence; the dashboard also caches selected data in browser localStorage.

## Setup

1. Install Node.js 22.12 or newer on a supported LTS release.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local` and fill in your Supabase project URL and publishable key.
4. Run `npm run dev` and open the local URL shown in the terminal.

Vite exposes variables prefixed with `VITE_` to the browser. Use the Supabase publishable key here; keep server credentials out of these variables.

The app requires an existing Supabase schema. This repository does not include migrations or automatically provision the database. The dashboard uses these tables:

- `profiles`, `products`, `inventory_movements`
- `sales`, `sale_items`, `returns`
- `suppliers`, `categories`, `audit_logs`

Stock and sales operations also require the database functions `record_stock_movement`, `complete_pos_sale`, `process_pos_return`, and `approve_pos_return` with the parameters used in `src/main.ts`.

Create accounts in Supabase Authentication and provide matching active `profiles` rows with an `admin` or `employee` role. Sign in with the account's email address using the corresponding Admin or Cashier tab. Database permissions and row-level security policies must enforce access for each role.

## Add users from the app

The Users → Add user form calls the `create-user` Edge Function. Deploy it once to your project:

```sh
npx supabase login
npx supabase functions deploy create-user --project-ref imvfxhcuallnbcrxdhix
```

The function uses Supabase's built-in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` server environment variables. Never add a service role key to `.env.local` or any `VITE_` variable. If deploying with the dashboard editor instead, create a function named `create-user`, paste `supabase/functions/create-user/index.ts`, and disable the platform JWT verification toggle; the handler validates the caller's token with Auth itself before requiring an active admin profile.

After deployment, sign in as an active admin, open Users → Add user, complete the form, and submit. The account appears in Authentication → Users and its matching row in Table Editor → profiles. Accounts created by an admin are email-confirmed and active accounts can sign in immediately using their email and password. An inactive profile is blocked by the app's login check; database RLS policies must also enforce active status.

The `profiles` table must have `id` (unique UUID matching the Auth user ID), `email`, `username`, `first_name`, `last_name`, `role`, and `active` columns, as used by the existing app. Enforce a case-insensitive unique username constraint in the database to prevent concurrent duplicate registrations. A failed profile save triggers deletion of the newly created Auth account; if cleanup also fails, the app asks the administrator to repair it in Supabase.

For password recovery, allow the deployed `/reset-password.html` URL (and the local development equivalent) in your Supabase authentication redirect settings.

## Commands

| Command                | Purpose                                                     |
| ---------------------- | ----------------------------------------------------------- |
| `npm run dev`          | Start the development server                                |
| `npm run typecheck`    | Check TypeScript, including unused declarations             |
| `npm test`             | Check authentication startup and password-reset behavior    |
| `npm run build`        | Check TypeScript and create the production build in `dist/` |
| `npm run preview`      | Preview the production build locally                        |
| `npm run format`       | Format project files                                        |
| `npm run format:check` | Check formatting without changing files                     |

## Project layout

- `index.html`, `src/login.ts`, `src/login.css`: sign-in and recovery-email flow. The selected account tab is kept in the URL so it survives refreshes.
- `src/login-background.ts`: optional 3D sign-in background, loaded independently of the form controls.
- `app.html`, `src/app.ts`: authenticated dashboard entry point.
- `src/main.ts`, `src/style.css`: inventory, sales, returns, suppliers, categories, users, audit logs, and 3D dashboard.
- `reset-password.html`, `src/reset-password.ts`: recovery-link and password-update flow.
- `src/supabase.ts`: shared Supabase client.
- `src/password-toggle.ts`: reusable password visibility controls.
- `src/landing.js`, `src/landing.css`: older landing-page assets; the current HTML entry points do not load them.
- `public/`: static assets copied into the build.

Deploy the contents of `dist/` to a host that serves all three HTML pages. Environment variables are read at build time, so rebuild after changing them.
