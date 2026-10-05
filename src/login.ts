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

/* ── Credentials helper ── */
const DEFAULT_CREDS: Record<string, { username: string; password: string }> = {
  admin:    { username: 'admin',   password: 'admin123'    },
  employee: { username: 'cashier', password: 'password123' },
};

function getCreds(): Record<string, { username: string; password: string }> {
  try {
    return JSON.parse(localStorage.getItem('wh-credentials') ?? '') as typeof DEFAULT_CREDS;
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_CREDS));
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

  const creds = getCreds();
  if (username !== creds.employee.username || password !== creds.employee.password) {
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

  const creds = getCreds();
  if (username !== creds.admin.username || password !== creds.admin.password) {
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

/* ── Reset Password Modal ── */
const resetOverlay = document.getElementById('resetModal') as HTMLElement;
const resetStep1   = document.getElementById('resetStep1') as HTMLElement;
const resetStep2   = document.getElementById('resetStep2') as HTMLElement;
const resetUsernameInput = document.getElementById('resetUsername') as HTMLInputElement;
const resetMsg     = document.getElementById('resetMsg') as HTMLElement;
const resetSuccessInfo = document.getElementById('resetSuccessInfo') as HTMLElement;

function openResetModal() {
  resetStep1.style.display = '';
  resetStep2.style.display = 'none';
  resetUsernameInput.value = '';
  resetMsg.textContent = '';
  resetMsg.className = 'reset-msg';
  resetOverlay.classList.add('open');
  requestAnimationFrame(() => resetUsernameInput.focus());
}

function closeResetModal() {
  resetOverlay.classList.remove('open');
}

document.getElementById('forgotCashier')?.addEventListener('click', openResetModal);
document.getElementById('forgotAdmin')?.addEventListener('click', openResetModal);
document.getElementById('closeResetModal')?.addEventListener('click', closeResetModal);
document.getElementById('cancelResetModal')?.addEventListener('click', closeResetModal);

// Close on backdrop click
resetOverlay.addEventListener('click', (e) => {
  if (e.target === resetOverlay) closeResetModal();
});

// Close on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && resetOverlay.classList.contains('open')) closeResetModal();
});

document.getElementById('confirmReset')?.addEventListener('click', () => {
  const username = resetUsernameInput.value.trim();

  if (!username) {
    resetMsg.textContent = 'Please enter your username.';
    resetMsg.className = 'reset-msg error';
    return;
  }

  const creds = getCreds();

  // Determine which account matches
  let roleKey: string | null = null;
  if (username === creds.admin.username || username === DEFAULT_CREDS.admin.username) {
    roleKey = 'admin';
  } else if (username === creds.employee.username || username === DEFAULT_CREDS.employee.username) {
    roleKey = 'employee';
  }

  if (!roleKey) {
    resetMsg.textContent = 'Username not found.';
    resetMsg.className = 'reset-msg error';
    resetUsernameInput.style.animation = 'none';
    resetUsernameInput.offsetHeight;
    resetUsernameInput.style.animation = 'shake 0.4s ease';
    return;
  }

  // Reset password to default
  const newCreds = JSON.parse(JSON.stringify(creds));
  newCreds[roleKey].password = DEFAULT_CREDS[roleKey].password;
  localStorage.setItem('wh-credentials', JSON.stringify(newCreds));

  // Show success step
  const defaultPass = DEFAULT_CREDS[roleKey].password;
  resetSuccessInfo.innerHTML =
    `New password: <strong>${defaultPass}</strong><br>` +
    `Please change it after logging in.`;

  resetStep1.style.display = 'none';
  resetStep2.style.display = '';
});

document.getElementById('closeResetSuccess')?.addEventListener('click', closeResetModal);

