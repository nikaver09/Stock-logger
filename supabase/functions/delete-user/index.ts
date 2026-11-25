import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return reply(405, { error: 'Use POST.' });
  try {
    const token = request.headers.get('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) return reply(401, { error: 'Please sign in again.' });
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) return reply(401, { error: 'Please sign in again.' });
    const { data: caller, error: callerError } = await admin.from('profiles').select('role, active').eq('id', auth.user.id).single();
    if (callerError || caller?.role !== 'admin' || caller.active !== true) {
      return reply(403, { error: 'Only active administrators can delete users.' });
    }
    let input;
    try { input = await request.json(); } catch { return reply(400, { error: 'Invalid request.' }); }
    const userId = input?.userId;
    if (typeof userId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      return reply(400, { error: 'Invalid user ID.' });
    }
    const targetId = userId.toLowerCase();
    if (targetId === auth.user.id.toLowerCase()) return reply(403, { error: 'You cannot delete your own account.' });
    const { data: target, error: targetError } = await admin.from('profiles').select('id, role, active').eq('id', targetId).maybeSingle();
    if (targetError) return reply(500, { error: 'Unable to verify the target account.' });
    if (!target) return reply(404, { error: 'The user profile no longer exists.' });
    if (target.active !== false) return reply(409, { error: 'Deactivate this account before permanently deleting it.' });

    // Fail closed if any history cannot be checked. The five references are
    // from the project's live foreign-key inspection provided by the owner.
    const refs = [
      ['sales', 'cashier_id'], ['inventory_movements', 'created_by'],
      ['returns', 'handled_by'], ['audit_logs', 'user_id'],
      ['delivery_logs', 'changed_by'],
    ] as const;
    for (const [table, column] of refs) {
      const { data, error } = await admin.from(table).select(column).eq(column, targetId).limit(1);
      if (error || !data) {
        console.error('History lookup failed', table, error?.code);
        return reply(500, { error: 'Unable to verify account history. No deletion was performed.' });
      }
      if (data.length) return reply(409, { error: 'This account has warehouse activity history. Keep it inactive to preserve historical attribution.' });
    }
    // Recheck state and caller authorization immediately before the destructive call.
    const { data: latest, error: latestError } = await admin.from('profiles').select('active').eq('id', targetId).single();
    const { data: latestCaller, error: latestCallerError } = await admin.from('profiles').select('role, active').eq('id', auth.user.id).single();
    if (latestError || latest?.active !== false) return reply(409, { error: 'Account status changed. Refresh the user list and try again.' });
    if (latestCallerError || latestCaller?.role !== 'admin' || latestCaller.active !== true) return reply(403, { error: 'Only active administrators can delete users.' });
    // Auth deletion cascades to profiles. Do not separately delete a profile.
    const { error: deleteError } = await admin.auth.admin.deleteUser(targetId, false);
    if (deleteError) {
      console.error('Auth deletion failed', deleteError.code);
      return reply(500, { error: 'Supabase could not delete the account. Check the function logs and account status before retrying.' });
    }
    return reply(200, { deleted: true, userId: targetId });
  } catch (error) {
    console.error('Unexpected delete-user error', error instanceof Error ? error.name : 'Unknown error');
    return reply(500, { error: 'Unable to confirm account deletion. Refresh and verify the account before retrying.' });
  }
});
