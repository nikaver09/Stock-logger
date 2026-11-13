import './style.css';
import { supabase } from './supabase';
import { configureAccess } from './access';

// Verify the account before initializing the dashboard or requesting its data.
async function startApp(): Promise<void> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  if (!data.session) {
    localStorage.removeItem('wh-session');
    window.location.replace('/');
    return;
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('username, role, active')
    .eq('id', data.session.user.id)
    .single();

  if (profileError) throw profileError;

  if (!profile?.active || !['admin', 'employee'].includes(profile.role)) {
    await supabase.auth.signOut();
    localStorage.removeItem('wh-session');
    window.location.replace('/');
    return;
  }

  localStorage.setItem(
    'wh-session',
    JSON.stringify({
      username: profile.username || data.session.user.email,
      role: profile.role,
    }),
  );

  localStorage.removeItem('wh-credentials');
  localStorage.removeItem('wh-users');
  configureAccess(profile.role);
  await import('./main');
}

void startApp().catch((error: unknown) => {
  localStorage.removeItem('wh-session');
  console.error('Dashboard initialization failed:', error);
  const message = document.querySelector('#loadingOverlay .loading-text');
  if (message) {
    message.textContent =
      'Unable to load the dashboard. Please refresh to try again.';
  }
});
