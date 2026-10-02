import './login.css';

function showLoader(text: string) {
  const loader = document.getElementById('loadingOverlay');
  if (loader) {
    const textEl = loader.querySelector('.loading-text');
    if (textEl) textEl.textContent = text;
    loader.classList.remove('hidden');
  }
}

function showError(msgId: string, text: string) {
  const msgEl = document.getElementById(msgId);
  if (msgEl) {
    msgEl.textContent = text;
    msgEl.classList.add('error');
    
    // Add a little shake effect (defined in CSS if needed, or just visual)
    msgEl.style.animation = 'none';
    msgEl.offsetHeight; // trigger reflow
    msgEl.style.animation = 'shake 0.4s ease';
  }
}

function clearError(msgId: string) {
  const msgEl = document.getElementById(msgId);
  if (msgEl) {
    msgEl.textContent = '';
    msgEl.classList.remove('error');
  }
}

/* ── Cashier (employee) form ── */
document.getElementById('employeeForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const usernameInput = document.getElementById('empUsername') as HTMLInputElement;
  const passwordInput = document.getElementById('empPassword') as HTMLInputElement;
  const username = usernameInput?.value.trim();
  const password = passwordInput?.value.trim();

  if (!username || !password) {
    showError('empMsg', 'Please enter both username and password.');
    return;
  }
  
  if (username !== 'cashier' || password !== 'password123') {
    showError('empMsg', 'Invalid username or password.');
    return;
  }

  clearError('empMsg');
  localStorage.setItem('wh-session', JSON.stringify({ username, role: 'employee' }));
  
  showLoader('Authenticating as Cashier...');
  setTimeout(() => {
    window.location.href = '/app.html';
  }, 600);
});

/* ── Admin form ── */
document.getElementById('adminForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const usernameInput = document.getElementById('adminUsername') as HTMLInputElement;
  const passwordInput = document.getElementById('adminPassword') as HTMLInputElement;
  const username = usernameInput?.value.trim();
  const password = passwordInput?.value.trim();

  if (!username || !password) {
    showError('adminMsg', 'Please enter both username and password.');
    return;
  }

  if (username !== 'admin' || password !== 'admin123') {
    showError('adminMsg', 'Invalid username or password.');
    return;
  }

  clearError('adminMsg');
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
