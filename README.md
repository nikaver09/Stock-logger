# Warehouse Logger

Warehouse inventory and point-of-sale app built with Vite, TypeScript, Three.js, Tailwind CSS, and Supabase. Supabase provides authentication and database persistence; the dashboard also caches selected data in browser localStorage.
Warehouse Logger is a web-based inventory management and point-of-sale application that brings stock tracking, sales, and product returns into one dashboard. It helps warehouse teams record incoming and outgoing stock, monitor product quantities, manage supplier and category records, and review transaction history. An interactive 3D warehouse view provides a visual overview of inventory alongside the app's operational tools.

Built with TypeScript, Vite, Three.js, Tailwind CSS, and Supabase, the application provides separate sign-in flows for administrators and cashiers. Supabase handles authentication and database persistence, while the dashboard caches selected data in browser localStorage. Administrators also have access to user management and audit logs.

## Features

- **Inventory tracking:** Record stock movements by SKU, view movement history, and identify low-stock items.
- **Interactive 3D dashboard:** Explore a warehouse rack visualization with orbit controls and selectable inventory items.
- **Point of sale:** Search available products, build orders, calculate totals, and record completed sales.
- **Product returns:** Submit return requests with quantities and reasons, view their review status, and restore stock through the return approval workflow.
- **Supplier and category management:** Maintain supplier contact details and product category records.
- **Account management:** Sign in by role, recover passwords by email, and update account credentials. Administrators can create accounts and manage profile roles and active status.
- **Audit logs:** Give administrators a view of recorded application activity.

The application requires a configured Supabase backend. Database functions and row-level security (RLS) policies must enforce permissions and validate stock, sales, and return operations; browser-side role checks alone do not provide database authorization.

## Setup

1. Install Node.js 22.12 or newer on a supported LTS release.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local` and fill in your Supabase project URL and publishable key.
3. Create `.env.local` in the project root with your Supabase project URL and publishable key:

   ```dotenv
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   ```

4. Run `npm run dev` and open the local URL shown in the terminal.

Vite exposes variables prefixed with `VITE_` to the browser. Use the Supabase publishable key here; keep server credentials out of these variables.

```sh
npx supabase login
npx supabase functions deploy create-user --project-ref imvfxhcuallnbcrxdhix
npx supabase functions deploy create-user --project-ref YOUR_PROJECT_REF
```

The function uses Supabase's built-in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` server environment variables. Never add a service role key to `.env.local` or any `VITE_` variable. If deploying with the dashboard editor instead, create a function named `create-user`, paste `supabase/functions/create-user/index.ts`, and disable the platform JWT verification toggle; the handler validates the caller's token with Auth itself before requiring an active admin profile.
| ---------------------- | ----------------------------------------------------------- |
| `npm run dev`          | Start the development server                                |
| `npm run typecheck`    | Check TypeScript, including unused declarations             |
| `npm test`             | Check authentication startup and password-reset behavior    |
| `npm test`             | Run authentication, role-access, and user-creation tests     |
| `npm run build`        | Check TypeScript and create the production build in `dist/` |
| `npm run preview`      | Preview the production build locally                        |
| `npm run format`       | Format project files                                        |