// Set only after app.ts verifies the active profile with Supabase.
let adminAccess = false;

export function configureAccess(role: 'admin' | 'employee'): void {
  adminAccess = role === 'admin';
  document.documentElement.toggleAttribute('data-admin-access', adminAccess);
  if (!adminAccess) {
    document
      .querySelectorAll('[data-admin-only]')
      .forEach((node) => node.remove());
    localStorage.removeItem('wh-users');
    localStorage.removeItem('wh-audit-logs');
  }
}

export function isAdmin(): boolean {
  return adminAccess;
}
