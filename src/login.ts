import './login.css';
import { enablePasswordToggles } from './password-toggle';

enablePasswordToggles();

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
type UserAccount = { id: string; username: string; role: 'admin' | 'employee'; firstName: string; lastName: string; email: string; active: boolean; password: string };

function readUsers(fallback: UserAccount[]): UserAccount[] {
  const stored = localStorage.getItem('wh-users');
  if (stored === null) return fallback;
  try {
    const parsed = JSON.parse(stored) as Array<Partial<UserAccount> & { name?: string; pw?: string }>;
    if (!Array.isArray(parsed)) return fallback;
    const users = parsed.flatMap((value, index) => {
      if (!value || typeof value !== 'object') return [];
      const email = typeof value.email === 'string' ? value.email.trim() : '';
      const username = typeof value.username === 'string' && value.username.trim() ? value.username.trim() : email.split('@')[0];
      if (!username) return [];
      const parts = typeof value.name === 'string' ? value.name.trim().split(/\s+/) : [];
      let password = typeof value.password === 'string' ? value.password : typeof value.pw === 'string' ? value.pw : '';
      if (typeof value.password !== 'string' && password) { try { password = atob(password); } catch { /* Keep an unencoded legacy value as-is. */ } }
      return [{
        id: typeof value.id === 'string' && value.id ? value.id : `migrated-${index}-${username.toLowerCase()}`,
        username, role: value.role === 'admin' ? 'admin' as const : 'employee' as const,
        firstName: typeof value.firstName === 'string' ? value.firstName : parts[0] ?? '',
        lastName: typeof value.lastName === 'string' ? value.lastName : parts.slice(1).join(' '),
        email, active: typeof value.active === 'boolean' ? value.active : true, password,
      }];
    });
    if (!users.length) return fallback;
    const canonical = JSON.stringify(users);
    if (canonical !== stored) localStorage.setItem('wh-users', canonical);
    return users;
  } catch { return fallback; }
}

function getCreds(): Record<string, { username: string; password: string }> {
  try {
    const stored = JSON.parse(localStorage.getItem('wh-credentials') ?? 'null') as Partial<typeof DEFAULT_CREDS> | null;
    return {
      admin: typeof stored?.admin?.username === 'string' && typeof stored.admin.password === 'string' ? stored.admin : DEFAULT_CREDS.admin,
      employee: typeof stored?.employee?.username === 'string' && typeof stored.employee.password === 'string' ? stored.employee : DEFAULT_CREDS.employee,
    };
  } catch {
    return { ...DEFAULT_CREDS };
  }
}

function getUsers(): UserAccount[] {
  const creds = getCreds();
  const builtinUsers: UserAccount[] = [
    { id: 'builtin-admin', username: creds.admin?.username ?? 'admin', role: 'admin', firstName: 'System', lastName: 'Administrator', email: 'admin@example.com', active: true, password: creds.admin?.password ?? 'admin123' },
    { id: 'builtin-employee', username: creds.employee?.username ?? 'cashier', role: 'employee', firstName: 'Store', lastName: 'Cashier', email: 'cashier@example.com', active: true, password: creds.employee?.password ?? 'password123' },
  ];
  const users = readUsers(builtinUsers);
  for (const builtin of builtinUsers) {
    const knownNames = [builtin.username, builtin.id === 'builtin-admin' ? DEFAULT_CREDS.admin.username : DEFAULT_CREDS.employee.username]
      .map((name) => name.toLowerCase());
    const index = users.findIndex((user) => user.id === builtin.id || knownNames.includes(user.username.toLowerCase()));
    if (index < 0) {
      users.push(builtin);
      continue;
    }

    const existing = users[index];
    users[index] = {
      ...existing,
      ...builtin,
      // Keep an intentionally disabled built-in account disabled.
      active: existing.active,
      firstName: existing.firstName || builtin.firstName,
      lastName: existing.lastName || builtin.lastName,
      email: existing.email || builtin.email,
    };
  }
  localStorage.setItem('wh-users', JSON.stringify(users));
  return users;
}

function recordAuthAudit(handledBy: string, action: string, description: string) {
  let entries: Array<Record<string, unknown>> = [];
  try {
    const stored = JSON.parse(localStorage.getItem('wh-audit-logs') ?? '[]');
    if (Array.isArray(stored)) entries = stored;
  } catch { /* Start a clean audit trail if stored data is malformed. */ }
  entries.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(), handledBy, module: 'Authentication', action, description,
    ipAddress: 'Unavailable in local browser',
  });
  localStorage.setItem('wh-audit-logs', JSON.stringify(entries.slice(0, 1000)));
}

/* ── Cashier (employee) form ── */
document.getElementById('employeeForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const usernameInput = document.getElementById('empUsername') as HTMLInputElement;
  const passwordInput = document.getElementById('empPassword') as HTMLInputElement;
  const username = usernameInput?.value.trim();
  const password = passwordInput?.value;

  if (!username || !password) {
    showError('empMsg', 'Please enter both username and password.');
    return;
  }

  const account = getUsers().find((user) => user.username.toLowerCase() === username.toLowerCase() || user.email.toLowerCase() === username.toLowerCase());
  const valid = !!account && account.active && account.role === 'employee' && account.password === password;
  if (!valid) {
    showError('empMsg', 'Invalid username or password.');
    return;
  }

  clearError('empMsg');
  recordAuthAudit(account.username, 'Signed in', 'Cashier signed in.');
  localStorage.setItem('wh-session', JSON.stringify({ username: account.username, role: account.role }));
  
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
  const password = passwordInput?.value;

  if (!username || !password) {
    showError('adminMsg', 'Please enter both username and password.');
    return;
  }

  const account = getUsers().find((user) => user.username.toLowerCase() === username.toLowerCase() || user.email.toLowerCase() === username.toLowerCase());
  const valid = !!account && account.active && account.role === 'admin' && account.password === password;
  if (!valid) {
    showError('adminMsg', 'Invalid username or password.');
    return;
  }

  clearError('adminMsg');
  recordAuthAudit(account.username, 'Signed in', 'Admin signed in.');
  localStorage.setItem('wh-session', JSON.stringify({ username: account.username, role: account.role }));
  
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
  const users = getUsers();
  const normalizedName = username.toLowerCase();
  const account = users.find((user) => user.username.toLowerCase() === normalizedName || user.email.toLowerCase() === normalizedName);

  // Reset either a managed account or a legacy built-in account.
  let roleKey: 'admin' | 'employee' | null = account?.role ?? null;
  if (!roleKey && (normalizedName === creds.admin.username.toLowerCase() || normalizedName === DEFAULT_CREDS.admin.username)) {
    roleKey = 'admin';
  } else if (!roleKey && (normalizedName === creds.employee.username.toLowerCase() || normalizedName === DEFAULT_CREDS.employee.username)) {
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
  const newPassword = DEFAULT_CREDS[roleKey].password;
  if (account) {
    account.password = newPassword;
    localStorage.setItem('wh-users', JSON.stringify(users));
    if (account.id === 'builtin-admin' || account.id === 'builtin-employee') {
      const newCreds = { ...creds, [roleKey]: { ...creds[roleKey], username: account.username, password: newPassword } };
      localStorage.setItem('wh-credentials', JSON.stringify(newCreds));
    }
  } else {
    const newCreds = { ...creds, [roleKey]: { ...creds[roleKey], password: newPassword } };
    localStorage.setItem('wh-credentials', JSON.stringify(newCreds));
  }
  recordAuthAudit(account?.username ?? username, 'Password reset', 'Password reset to the default for this account.');

  // Show success step
  const defaultPass = newPassword;
  resetSuccessInfo.innerHTML =
    `New password: <strong>${defaultPass}</strong><br>` +
    `Please change it after logging in.`;

  resetStep1.style.display = 'none';
  resetStep2.style.display = '';
});

document.getElementById('closeResetSuccess')?.addEventListener('click', closeResetModal);

import * as THREE from 'three';

// --- 3D Background Mosaic Tiles ---
function init3DBackground() {
  const canvas = document.getElementById('bg-canvas') as HTMLCanvasElement;
  if (!canvas) return;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  
  const scene = new THREE.Scene();

  // Create an isometric camera
  const aspect = window.innerWidth / window.innerHeight;
  const d = 25;
  const camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 1, 1000);
  camera.position.set(30, 30, 30);
  camera.lookAt(scene.position);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambientLight);
  
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 20, 10);
  scene.add(dirLight);

  // Blue accent point light
  const pointLight = new THREE.PointLight(0x3b82f6, 500, 150);
  pointLight.position.set(0, 15, 0);
  scene.add(pointLight);

  // Instanced mesh for tiles
  const gridSize = 35; // 35x35 grid
  const boxSize = 1.95;
  const geometry = new THREE.BoxGeometry(boxSize, boxSize, boxSize);
  
  // Metallic material with #999999 color
  const material = new THREE.MeshStandardMaterial({ 
    color: 0x999999, 
    roughness: 0.1, 
    metalness: 0.8 
  });
  
  const mesh = new THREE.InstancedMesh(geometry, material, gridSize * gridSize);
  
  const dummy = new THREE.Object3D();
  let idx = 0;
  const offset = (gridSize * 2) / 2;
  
  for (let x = 0; x < gridSize; x++) {
    for (let z = 0; z < gridSize; z++) {
      const posX = x * 2 - offset;
      const posZ = z * 2 - offset;
      dummy.position.set(posX, 0, posZ);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx++, dummy.matrix);
    }
  }
  scene.add(mesh);

  // Animation loop
  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const time = clock.getElapsedTime();
    
    // Animate tiles in a gentle wave pattern
    let i = 0;
    for (let x = 0; x < gridSize; x++) {
      for (let z = 0; z < gridSize; z++) {
        const posX = x * 2 - offset;
        const posZ = z * 2 - offset;
        
        // sine wave math
        const y = Math.sin(posX * 0.15 + time * 0.8) * Math.cos(posZ * 0.15 + time * 0.8) * 2;
        
        dummy.position.set(posX, y, posZ);
        dummy.updateMatrix();
        mesh.setMatrixAt(i++, dummy.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    
    // Slow rotation of the scene for a dynamic feel
    scene.rotation.y = time * 0.03;

    renderer.render(scene, camera);
  }
  
  animate();

  // Resize handler
  window.addEventListener('resize', () => {
    const aspect = window.innerWidth / window.innerHeight;
    camera.left = -d * aspect;
    camera.right = d * aspect;
    camera.top = d;
    camera.bottom = -d;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

init3DBackground();

