import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS')
    return new Response(null, { headers: cors });
  if (request.method !== 'POST') return reply(405, { error: 'Use POST.' });

  try {
    const token = request.headers
      .get('Authorization')
      ?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) return reply(401, { error: 'Please sign in again.' });

    // This key stays in Supabase's server environment, never in the Vite app.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user)
      return reply(401, { error: 'Please sign in again.' });

    const { data: caller, error: callerError } = await admin
      .from('profiles')
      .select('role, active')
      .eq('id', auth.user.id)
      .single();
    if (callerError || caller?.role !== 'admin' || caller.active !== true) {
      return reply(403, {
        error: 'Only active administrators can create users.',
      });
    }

    let input;
    try {
      input = await request.json();
    } catch {
      return reply(400, { error: 'Invalid request.' });
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return reply(400, { error: 'Invalid request.' });
    }
    const text = (value: unknown) =>
      typeof value === 'string' ? value.trim() : '';
    const email = text(input.email).toLowerCase();
    const username = text(input.username);
    const firstName = text(input.firstName);
    const lastName = text(input.lastName);
    const { password, role, active } = input;
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 120 ||
      username.length < 3 ||
      username.length > 40 ||
      !firstName ||
      firstName.length > 60 ||
      !lastName ||
      lastName.length > 60 ||
      typeof password !== 'string' ||
      password.length < 6 ||
      password.length > 128 ||
      !['admin', 'employee'].includes(role) ||
      typeof active !== 'boolean'
    ) {
      return reply(400, {
        error:
          'Provide a valid email, names, username (3–40 characters), role, and password (6–128 characters).',
      });
    }

    const { data: matches, error: lookupError } = await admin
      .from('profiles')
      .select('id')
      .ilike('username', username.replace(/[\\%_]/g, '\\$&'))
      .limit(1);
    if (lookupError)
      return reply(500, {
        error: 'Unable to check the username. Please try again.',
      });
    if (matches?.length)
      return reply(409, { error: 'That username is already in use.' });

    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { username, first_name: firstName, last_name: lastName },
      });
    if (createError || !created.user) {
      return reply(400, {
        error: createError?.message ?? 'Unable to create the account.',
      });
    }

    // Upsert also supports projects that create a default profile with an Auth trigger.
    const { error: profileError } = await admin.from('profiles').upsert(
      {
        id: created.user.id,
        email,
        username,
        first_name: firstName,
        last_name: lastName,
        role,
        active,
      },
      { onConflict: 'id' },
    );
    if (profileError) {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(
        created.user.id,
      );
      if (cleanupError) {
        console.error('Account cleanup failed', created.user.id);
        return reply(500, {
          error:
            'The account was created but its profile could not be saved. Ask an administrator to repair or remove it in Supabase before retrying.',
        });
      }
      console.error('Profile creation failed', profileError.code);
      return reply(500, {
        error:
          'The profile could not be saved. Account creation was cancelled. Check the profiles table configuration.',
      });
    }

    return reply(201, {
      user: { id: created.user.id, email, username, role, active },
    });
  } catch {
    return reply(500, {
      error: 'Unable to create the user. Please try again.',
    });
  }
});
