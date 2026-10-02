import './login.css';

function showLoader(text: string) {
  const loader = document.getElementById('loadingOverlay');
  if (loader) {
    const textEl = loader.querySelector('.loading-text');
    if (textEl) textEl.textContent = text;
    loader.classList.remove('hidden');
  }
}

/* ── Cashier (employee) form — no credential check ── */
document.getElementById('employeeForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const username = (document.getElementById('empUsername') as HTMLInputElement)?.value.trim() || 'cashier';
  localStorage.setItem('wh-session', JSON.stringify({ username, role: 'employee' }));
  
  showLoader('Authenticating as Cashier...');
  setTimeout(() => {
    window.location.href = '/app.html';
  }, 600);
});

/* ── Admin form — no credential check ── */
document.getElementById('adminForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const username = (document.getElementById('adminUsername') as HTMLInputElement)?.value.trim() || 'admin';
  localStorage.setItem('wh-session', JSON.stringify({ username, role: 'admin' }));
  
  showLoader('Authenticating as Admin...');
  setTimeout(() => {
    window.location.href = '/app.html';
  }, 600);
});

/* ── loading overlay ── */
window.addEventListener('load', () => {
  setTimeout(() => {
    const loader = document.getElementById('loadingOverlay');
    if (loader) {
      loader.classList.add('hidden');
    }
  }, 500);
});
