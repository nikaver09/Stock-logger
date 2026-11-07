import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (
  !supabaseUrl ||
  !supabaseKey ||
  supabaseUrl.includes('your-project.supabase.co') ||
  /your[-_].*key|placeholder/i.test(supabaseKey)
) {
  throw new Error(
    'Missing Supabase configuration. Copy .env.example to .env.local and set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.',
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey);
