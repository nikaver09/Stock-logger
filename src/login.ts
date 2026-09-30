import './login.css';

let currentRole = 'admin';

document.addEventListener('DOMContentLoaded', () => {
  const tabAdmin = document.getElementById('tabAdmin');
  const tabEmployee = document.getElementById('tabEmployee');
  const loginEye = document.getElementById('loginEye');
  const loginForm = document.getElementById('loginForm');

  if (tabAdmin) {
    tabAdmin.addEventListener('click', () => switchRole('admin'));
  }
  if (tabEmployee) {
    tabEmployee.addEventListener('click', () => switchRole('employee'));
  }
  if (loginEye) {
    loginEye.addEventListener('click', () => togglePw('loginPassword'));
  }
  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }

  /* Dismiss loader */
  setTimeout(() => {
    const loader = document.getElementById('loadingOverlay');
    if (loader) {
      loader.classList.add('hidden');
      setTimeout(() => loader.remove(), 2000);
    }
  }, 2000);
});

/* ── switch role tab ── */
function switchRole(role: string) {
  currentRole = role;
  const isAdmin = role === 'admin';

  const tabAdmin = document.getElementById('tabAdmin');
  const tabEmployee = document.getElementById('tabEmployee');
  const formTitle = document.getElementById('formTitle');

  if (tabAdmin) {
    tabAdmin.classList.toggle('active', isAdmin);
    tabAdmin.setAttribute('aria-selected', String(isAdmin));
  }

  if (tabEmployee) {
    tabEmployee.classList.toggle('active', !isAdmin);
    tabEmployee.setAttribute('aria-selected', String(!isAdmin));
  }

  if (formTitle) {
    formTitle.textContent = isAdmin ? 'Admin Login' : 'Employee Login';
  }
  
  clearMsg();
}

function clearMsg() {
  const el = document.getElementById('loginMsg');
  if (el) { 
    el.textContent = ''; 
    el.className = 'auth-msg'; 
  }
}

/* ── password show/hide ── */
function togglePw(inputId: string) {
  const input = document.getElementById(inputId) as HTMLInputElement | null;
  if (input) {
    input.type = input.type === 'password' ? 'text' : 'password';
  }
}

/* ── message helper ── */
function showMsg(id: string, text: string, isErr: boolean) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = text;
    el.className = 'auth-msg show ' + (isErr ? 'err' : 'ok');
  }
}

function setLoading(btnId: string, txtId: string, loading: boolean, label: string) {
  const btn = document.getElementById(btnId) as HTMLButtonElement | null;
  const txt = document.getElementById(txtId);
  if (btn) btn.disabled = loading;
  if (txt) txt.textContent = loading ? 'Please wait…' : label;
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

/* ── login submit ── */
async function handleLogin(e: Event) {
  e.preventDefault();
  const usernameInput = document.getElementById('loginUsername') as HTMLInputElement | null;
  const pwInput = document.getElementById('loginPassword') as HTMLInputElement | null;
  
  const username = usernameInput?.value.trim() || '';
  const pw = pwInput?.value || '';

  clearMsg();
  setLoading('loginBtn', 'loginBtnText', true, 'Log in');
  await delay(700);
  setLoading('loginBtn', 'loginBtnText', false, 'Log in');

  if (!username || !pw) {
    showMsg('loginMsg', 'Please enter both username and password.', true);
    return;
  }

  if (currentRole === 'admin') {
    if (username !== 'admin' || pw !== 'admin123') {
      showMsg('loginMsg', 'Invalid admin credentials', true);
      return;
    }
  } else {
    if (username !== 'employee' || pw !== 'employee123') {
      showMsg('loginMsg', 'Invalid employee credentials', true);
      return;
    }
  }

  localStorage.setItem('wh-session', JSON.stringify({ username, role: currentRole }));
  showMsg('loginMsg', `Logged in as ${currentRole.toUpperCase()}! Redirecting…`, false);

  setTimeout(() => {
    window.location.href = 'app.html';
  }, 900);
}
