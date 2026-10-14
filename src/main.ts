import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { enablePasswordToggles } from './password-toggle';
import './style.css';

enablePasswordToggles();

/* ---------- auth guard ---------- */
(function checkAuth() {
  try {
    let session = JSON.parse(localStorage.getItem('wh-session') ?? 'null');
    if (!session?.username) {
      session = { username: 'admin', role: 'admin' };
      localStorage.setItem('wh-session', JSON.stringify(session));
    }
  } catch {
    localStorage.setItem('wh-session', JSON.stringify({ username: 'admin', role: 'admin' }));
  }
})();

type Item = { sku: string; name: string; qty: number; slot: number };
type Log = { id: number; time: string; sku: string; type: 'IN' | 'OUT'; qty: number; note: string };
type Move = 'IN' | 'OUT';
type SaleLine = { sku: string; name: string; qty: number; returned: number };
type Sale = { id: string; time: string; customer: string; reference: string; lines: SaleLine[] };
type User = { id: string; username: string; role: 'admin' | 'employee'; firstName: string; lastName: string; email: string; active: boolean; password: string };
type Supplier = { id: string; name: string; contactPerson: string; phone: string; email: string; address: string; active: boolean };
type AuditEntry = { id: string; createdAt: string; handledBy: string; module: string; action: string; description: string; ipAddress: string };

const DEFAULT_CREDS: Record<string, { username: string; password: string }> = {
  admin: { username: 'admin', password: 'admin123' },
  employee: { username: 'cashier', password: 'password123' },
};

const COLS = 4, LEVELS = 3, SLOTS = COLS * LEVELS, LOW = 10, CAP = 200;
const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;

/* ---------- state ---------- */
const seed: Item[] = [
  { sku: 'BLT-001', name: 'Hex bolts M8', qty: 120, slot: 0 },
  { sku: 'PLT-014', name: 'Pallet wrap', qty: 45, slot: 1 },
  { sku: 'BOX-220', name: 'Carton 40x30', qty: 8, slot: 5 },
];
function load<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? '') as T; } catch { return fallback; }
}
function readUsers(fallback: User[]): User[] {
  const stored = localStorage.getItem('wh-users');
  if (stored === null) return fallback;
  try {
    const parsed = JSON.parse(stored) as Array<Partial<User> & { name?: string; pw?: string }>;
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
function loadCreds(): Record<string, { username: string; password: string }> {
  try {
    const stored = JSON.parse(localStorage.getItem('wh-credentials') ?? 'null') as Partial<typeof DEFAULT_CREDS> | null;
    return {
      admin: typeof stored?.admin?.username === 'string' && typeof stored.admin.password === 'string' ? stored.admin : DEFAULT_CREDS.admin,
      employee: typeof stored?.employee?.username === 'string' && typeof stored.employee.password === 'string' ? stored.employee : DEFAULT_CREDS.employee,
    };
  } catch { return { ...DEFAULT_CREDS }; }
}
const initialCreds = loadCreds();
let users: User[] = readUsers([
  { id: 'builtin-admin', username: initialCreds.admin?.username ?? 'admin', role: 'admin', firstName: 'System', lastName: 'Administrator', email: 'admin@example.com', active: true, password: initialCreds.admin?.password ?? 'admin123' },
  { id: 'builtin-employee', username: initialCreds.employee?.username ?? 'cashier', role: 'employee', firstName: 'Store', lastName: 'Cashier', email: 'cashier@example.com', active: true, password: initialCreds.employee?.password ?? 'password123' },
]);
let items: Item[] = load('wh-items', seed);
let logs: Log[] = load('wh-logs', []);
let sales: Sale[] = load('wh-sales', []);
let suppliers: Supplier[] = load('wh-suppliers', []);
const storedAuditEntries = load<unknown>('wh-audit-logs', []);
let auditEntries: AuditEntry[] = Array.isArray(storedAuditEntries)
  ? storedAuditEntries.filter((entry): entry is AuditEntry => !!entry && typeof entry === 'object'
    && typeof entry.id === 'string' && typeof entry.createdAt === 'string' && typeof entry.handledBy === 'string'
    && typeof entry.module === 'string' && typeof entry.action === 'string' && typeof entry.description === 'string'
    && typeof entry.ipAddress === 'string')
  : [];
let type: Move = 'IN';
const save = () => {
  localStorage.setItem('wh-items', JSON.stringify(items));
  localStorage.setItem('wh-logs', JSON.stringify(logs));
  localStorage.setItem('wh-sales', JSON.stringify(sales));
  localStorage.setItem('wh-users', JSON.stringify(users));
  localStorage.setItem('wh-suppliers', JSON.stringify(suppliers));
  localStorage.setItem('wh-audit-logs', JSON.stringify(auditEntries));
};

function recordAudit(module: string, action: string, description: string, handledBy?: string) {
  const session = getSession();
  auditEntries.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    handledBy: handledBy ?? session?.username ?? 'System',
    module, action, description, ipAddress: 'Unavailable in local browser',
  });
  auditEntries = auditEntries.slice(0, 1000);
  renderAuditLogs();
}

/* ---------- 3D scene ---------- */
const host = $<HTMLDivElement>('#scene');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(6, 5, 9);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2.05;
controls.minDistance = 5; controls.maxDistance = 20;

scene.background = new THREE.Color(0xeae7e3);
scene.add(new THREE.HemisphereLight(0xffffff, 0xe8e5e0, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(5, 10, 6);
scene.add(sun);
const fill = new THREE.DirectionalLight(0xffffff, 0.4);
fill.position.set(-5, 3, -6);
scene.add(fill);

const floor = new THREE.GridHelper(16, 16, 0xc0bdb8, 0xd4d0cb);
scene.add(floor);

const W = 1.2, GAP = 1.5;
const rackMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.7, roughness: 0.3 });
for (let l = 0; l <= LEVELS; l++) {
  const plank = new THREE.Mesh(new THREE.BoxGeometry(COLS * W + 0.2, 0.1, W), rackMat);
  plank.position.y = l * GAP - 0.05;
  scene.add(plank);
}
for (const x of [-1, 1]) for (const z of [-1, 1]) {
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, LEVELS * GAP, 0.1), rackMat);
  post.position.set(x * (COLS * W) / 2, (LEVELS * GAP) / 2 - 0.05, z * (W / 2 - 0.05));
  scene.add(post);
}

const slotXZ = (slot: number) => ({
  x: ((slot % COLS) - (COLS - 1) / 2) * W,
  base: Math.floor(slot / COLS) * GAP,
});
const height = (qty: number) => 0.15 + Math.min(qty, CAP) / CAP * 1.1;
const hue = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7) / 360;
const boxSaturation = 0.3;
const boxLightness = 0.45;

type Box = THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> & { cur: number; glow: number };
const boxes = new Map<string, Box>();
const boxGeo = new THREE.BoxGeometry(1, 1, 1);

function syncBoxes() {
  for (const it of items) {
    let b = boxes.get(it.sku);
    if (!b) {
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue(it.sku), boxSaturation, boxLightness), roughness: 0.4, metalness: 0.3 });
      b = Object.assign(new THREE.Mesh(boxGeo, mat), { cur: 0.01, glow: 1 }) as Box;
      b.userData.sku = it.sku;
      scene.add(b);
      boxes.set(it.sku, b);
    }
    b.userData.target = height(it.qty);
    b.material.emissive.set(it.qty < LOW ? 0xc43e2a : 0x000000);
  }
}

const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
const tip = $<HTMLDivElement>('#tip');
function pick(e: PointerEvent): Box | undefined {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  return ray.intersectObjects([...boxes.values()])[0]?.object as Box | undefined;
}
renderer.domElement.addEventListener('pointermove', (e) => {
  const b = pick(e), it = items.find((i) => i.sku === b?.userData.sku);
  tip.style.opacity = it ? '1' : '0';
  if (it) {
    tip.textContent = `${it.sku} · ${it.name} · ${it.qty} units`;
    tip.style.left = e.offsetX + 14 + 'px'; tip.style.top = e.offsetY + 14 + 'px';
  }
});
renderer.domElement.addEventListener('click', (e) => {
  const b = pick(e);
  if (b) { $<HTMLInputElement>('#sku').value = b.userData.sku; $<HTMLInputElement>('#qty').focus(); }
});

function resize() {
  const { clientWidth: w, clientHeight: h } = host;
  renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(host);

const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
(function loop() {
  requestAnimationFrame(loop);
  for (const it of items) {
    const b = boxes.get(it.sku); if (!b) continue;
    const t = b.userData.target as number;
    b.cur += (t - b.cur) * (still ? 1 : 0.12);
    const { x, base } = slotXZ(it.slot);
    b.scale.set(0.95, b.cur, 0.95);
    b.position.set(x, base + b.cur / 2, 0);
    b.glow *= 0.92;
    b.material.emissiveIntensity = it.qty < LOW ? 0.5 : 0;
    if (b.glow > 0.02) b.material.emissive.lerp(new THREE.Color(b.userData.flash ?? 0x000000), b.glow * 0.3);
  }
  controls.update();
  renderer.render(scene, camera);
})();

/* ---------- UI ---------- */
const msg = $<HTMLParagraphElement>('#msg');
const say = (t: string, ok = false) => { msg.textContent = t; msg.className = 'msg ' + (ok ? 'ok' : 'err'); };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function renderUI() {
  const units = items.reduce((a, i) => a + i.qty, 0);
  $('#stats').innerHTML = [
    ['SKUs', items.length], ['Units on hand', units], ['Low stock', items.filter((i) => i.qty < LOW).length],
  ].map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');

  $('#skus').innerHTML = items.map((i) => `<option value="${esc(i.sku)}">${esc(i.name)}</option>`).join('');

  $('#inv').innerHTML = items.length
    ? `<thead><tr><th>SKU</th><th>Item</th><th>Slot</th><th style="text-align:right">Qty</th></tr></thead><tbody>` +
      items.map((i) => `<tr class="pick" data-sku="${esc(i.sku)}"><td>${esc(i.sku)}</td><td>${esc(i.name)}</td>
        <td>${'ABC'[Math.floor(i.slot / COLS)]}${(i.slot % COLS) + 1}</td>
        <td class="num ${i.qty < LOW ? 'low' : ''}">${i.qty}</td></tr>`).join('') + '</tbody>'
    : '<tbody><tr><td class="empty">No stock yet. Log a stock in to add your first SKU.</td></tr></tbody>';

  $('#log').innerHTML = logs.length
    ? `<thead><tr><th>Time</th><th>Type</th><th>SKU</th><th style="text-align:right">Qty</th><th>Note</th></tr></thead><tbody>` +
      logs.slice(0, 50).map((l) => `<tr><td>${l.time}</td><td><span class="tag ${l.type}">${l.type}</span></td>
        <td>${esc(l.sku)}</td><td class="num">${l.qty}</td><td>${esc(l.note)}</td></tr>`).join('') + '</tbody>'
    : '<tbody><tr><td class="empty">Nothing logged yet.</td></tr></tbody>';

  syncBoxes();
  renderSales();
  renderSuppliers();
  renderUsers();
  renderAuditLogs();
}

let userSort: { field: keyof Pick<User, 'username' | 'role' | 'email' | 'lastName'>; direction: 1 | -1 } = { field: 'username', direction: 1 };
let userPage = 1;
const USERS_PER_PAGE = 10;
function renderUsers() {
  const table = $('#usersTable');
  if (!table) return;
  const search = ($<HTMLInputElement>('#userSearch')?.value ?? '').trim().toLowerCase();
  const visible = users.filter((user) => user.username.toLowerCase().includes(search)).sort((a, b) => {
    const av = userSort.field === 'lastName' ? a.lastName : a[userSort.field];
    const bv = userSort.field === 'lastName' ? b.lastName : b[userSort.field];
    return String(av).localeCompare(String(bv)) * userSort.direction;
  });
  const pageCount = Math.max(1, Math.ceil(visible.length / USERS_PER_PAGE));
  userPage = Math.min(userPage, pageCount);
  const pageUsers = visible.slice((userPage - 1) * USERS_PER_PAGE, userPage * USERS_PER_PAGE);
  const count = $('#userCount');
  if (count) count.textContent = `${users.length} ${users.length === 1 ? 'user' : 'users'}`;
  const headers: Array<[string, string]> = [['username', 'Username'], ['role', 'Role'], ['email', 'Email'], ['lastName', 'Last name']];
  table.innerHTML = pageUsers.length
    ? `<thead><tr>${headers.map(([field, label]) => `<th><button type="button" class="user-sort" data-user-sort="${field}">${label}<span aria-hidden="true">${userSort.field === field ? (userSort.direction === 1 ? '↑' : '↓') : '↕'}</span></button></th>`).join('')}<th>Status</th><th class="user-actions-heading">Actions</th></tr></thead><tbody>${pageUsers.map((user) => `<tr>
        <td class="user-name-cell">${esc(user.username)}</td><td>${user.role === 'admin' ? 'Admin' : 'Cashier'}</td><td>${esc(user.email)}</td><td>${esc(user.lastName)}</td>
        <td><span class="user-status ${user.active ? 'is-active' : 'is-inactive'}">${user.active ? 'Active' : 'Inactive'}</span></td>
        <td class="user-actions"><button type="button" class="user-edit" data-edit-user="${esc(user.id)}" aria-label="Edit ${esc(user.username)}" title="Edit user"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 4 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/></svg></button><button type="button" class="user-delete" data-delete-user="${esc(user.id)}" aria-label="Delete ${esc(user.username)}" title="Delete user"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg></button></td>
      </tr>`).join('')}</tbody>`
    : `<tbody><tr><td class="users-empty" colspan="6">${users.length ? 'No users match that username.' : 'No users have been added yet.'}</td></tr></tbody>`;
  const pagination = $('#usersPagination');
  if (pagination) {
    const from = visible.length ? (userPage - 1) * USERS_PER_PAGE + 1 : 0;
    const to = Math.min(userPage * USERS_PER_PAGE, visible.length);
    pagination.innerHTML = `<span class="users-pagination-summary">Showing ${from}–${to} of ${visible.length}</span><div class="users-pagination-actions"><button type="button" data-user-page="prev" ${userPage <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${userPage} of ${pageCount}</span><button type="button" data-user-page="next" ${userPage >= pageCount ? 'disabled' : ''}>Next</button></div>`;
  }
}

let supplierSort: { field: keyof Pick<Supplier, 'name' | 'contactPerson' | 'phone' | 'email' | 'address'>; direction: 1 | -1 } = { field: 'name', direction: 1 };
let supplierPage = 1;
const SUPPLIERS_PER_PAGE = 10;
function renderSuppliers() {
  const table = $('#suppliersTable');
  if (!table) return;
  const search = ($<HTMLInputElement>('#supplierSearch')?.value ?? '').trim().toLowerCase();
  const visible = suppliers.filter((supplier) => supplier.name.toLowerCase().includes(search)).sort((a, b) =>
    a[supplierSort.field].localeCompare(b[supplierSort.field]) * supplierSort.direction);
  const pageCount = Math.max(1, Math.ceil(visible.length / SUPPLIERS_PER_PAGE));
  supplierPage = Math.min(supplierPage, pageCount);
  const pageSuppliers = visible.slice((supplierPage - 1) * SUPPLIERS_PER_PAGE, supplierPage * SUPPLIERS_PER_PAGE);
  const columns: Array<[typeof supplierSort.field, string]> = [
    ['name', 'Name'], ['contactPerson', 'Contact Person'], ['phone', 'Phone Number'], ['email', 'Email'], ['address', 'Address'],
  ];
  table.innerHTML = pageSuppliers.length
    ? `<thead><tr>${columns.map(([field, label]) => `<th><button type="button" class="user-sort" data-supplier-sort="${field}">${label}<span aria-hidden="true">${supplierSort.field === field ? (supplierSort.direction === 1 ? '↑' : '↓') : '↕'}</span></button></th>`).join('')}<th>Status</th></tr></thead><tbody>${pageSuppliers.map((supplier) => `<tr>
        <td><button type="button" class="supplier-name-button" data-edit-supplier="${esc(supplier.id)}">${esc(supplier.name)}</button></td>
        <td class="supplier-contact-cell" title="${esc(supplier.contactPerson)}">${esc(supplier.contactPerson)}</td><td>${esc(supplier.phone)}</td><td>${esc(supplier.email)}</td><td>${esc(supplier.address)}</td>
        <td><button type="button" class="user-status ${supplier.active ? 'is-active' : 'is-inactive'}" data-toggle-supplier="${esc(supplier.id)}" aria-label="Set ${esc(supplier.name)} ${supplier.active ? 'inactive' : 'active'}">${supplier.active ? 'Active' : 'Inactive'}</button></td>
      </tr>`).join('')}</tbody>`
    : `<tbody><tr><td class="users-empty" colspan="6">${suppliers.length ? 'No suppliers match that name.' : 'No suppliers yet. Add your first supplier to get started.'}</td></tr></tbody>`;
  const pagination = $('#suppliersPagination');
  if (pagination) {
    const from = visible.length ? (supplierPage - 1) * SUPPLIERS_PER_PAGE + 1 : 0;
    const to = Math.min(supplierPage * SUPPLIERS_PER_PAGE, visible.length);
    pagination.innerHTML = `<span class="users-pagination-summary">Showing ${from}–${to} of ${visible.length}</span><div class="users-pagination-actions"><button type="button" data-supplier-page="prev" ${supplierPage <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${supplierPage} of ${pageCount}</span><button type="button" data-supplier-page="next" ${supplierPage >= pageCount ? 'disabled' : ''}>Next</button></div>`;
  }
}

let auditSort: { field: keyof AuditEntry; direction: 1 | -1 } = { field: 'createdAt', direction: -1 };
let auditPage = 1;
const AUDIT_PAGE_SIZE = 10;
const auditDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
};
function renderAuditLogs() {
  const table = $('#auditTable');
  if (!table) return;
  const moduleFilter = ($<HTMLInputElement>('#auditSearch')?.value ?? '').trim().toLowerCase();
  const visible = auditEntries.filter((entry) => entry.module.toLowerCase().includes(moduleFilter)).sort((a, b) => {
    const comparison = auditSort.field === 'createdAt'
      ? a.createdAt.localeCompare(b.createdAt)
      : a[auditSort.field].localeCompare(b[auditSort.field]);
    return comparison * auditSort.direction;
  });
  const pageCount = Math.max(1, Math.ceil(visible.length / AUDIT_PAGE_SIZE));
  auditPage = Math.min(auditPage, pageCount);
  const pageEntries = visible.slice((auditPage - 1) * AUDIT_PAGE_SIZE, auditPage * AUDIT_PAGE_SIZE);
  const columns: Array<[keyof AuditEntry, string]> = [
    ['createdAt', 'Created at'], ['handledBy', 'Handled by'], ['module', 'Module'], ['action', 'Action'], ['description', 'Description'], ['ipAddress', 'IP Address'],
  ];
  table.innerHTML = pageEntries.length
    ? `<thead><tr>${columns.map(([field, label]) => `<th><button type="button" class="user-sort" data-audit-sort="${field}">${label}<span aria-hidden="true">${auditSort.field === field ? (auditSort.direction === 1 ? '↑' : '↓') : '↕'}</span></button></th>`).join('')}<th class="audit-actions-heading">Actions</th></tr></thead><tbody>${pageEntries.map((entry) => `<tr>
        <td>${esc(auditDate(entry.createdAt))}</td><td>${esc(entry.handledBy)}</td><td><span class="audit-module-tag">${esc(entry.module)}</span></td><td>${esc(entry.action)}</td>
        <td class="audit-description-cell" title="${esc(entry.description)}">${esc(entry.description)}</td><td title="IP address is not exposed by this local browser app">${esc(entry.ipAddress || '—')}</td>
        <td class="audit-actions-cell"><button type="button" class="audit-view-button" data-audit-detail="${esc(entry.id)}" aria-label="View audit details">View</button></td>
      </tr>`).join('')}</tbody>`
    : `<thead><tr>${columns.map(([field, label]) => `<th><button type="button" class="user-sort" data-audit-sort="${field}">${label}<span aria-hidden="true">${auditSort.field === field ? (auditSort.direction === 1 ? '↑' : '↓') : '↕'}</span></button></th>`).join('')}<th>Actions</th></tr></thead><tbody><tr><td class="audit-no-results" colspan="7">No results.</td></tr></tbody>`;
  const pagination = $('#auditPagination');
  if (pagination) {
    const from = visible.length ? (auditPage - 1) * AUDIT_PAGE_SIZE + 1 : 0;
    const to = Math.min(auditPage * AUDIT_PAGE_SIZE, visible.length);
    pagination.innerHTML = `<span class="users-pagination-summary">Showing ${from}–${to} of ${visible.length}</span><div class="users-pagination-actions"><button type="button" data-audit-page="prev" ${auditPage <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${auditPage} of ${pageCount}</span><button type="button" data-audit-page="next" ${auditPage >= pageCount ? 'disabled' : ''}>Next</button></div>`;
  }
}

$('#auditSearch')?.addEventListener('input', () => { auditPage = 1; renderAuditLogs(); });
$('#auditTable')?.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const sort = target.closest<HTMLButtonElement>('[data-audit-sort]');
  if (sort) {
    const field = sort.dataset.auditSort as keyof AuditEntry;
    auditSort = { field, direction: auditSort.field === field ? (auditSort.direction === 1 ? -1 : 1) : field === 'createdAt' ? -1 : 1 };
    auditPage = 1; renderAuditLogs(); return;
  }
  const view = target.closest<HTMLButtonElement>('[data-audit-detail]');
  if (view) {
    const entry = auditEntries.find((item) => item.id === view.dataset.auditDetail);
    if (!entry) return;
    const details: Array<[string, string]> = [
      ['Created at', auditDate(entry.createdAt)], ['Handled by', entry.handledBy], ['Module', entry.module],
      ['Action', entry.action], ['Description', entry.description], ['IP address', entry.ipAddress || 'Unavailable in local browser'],
    ];
    $('#auditDetailContent').innerHTML = details.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('');
    openModal('auditDetailModal');
  }
});
$('#auditPagination')?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-audit-page]');
  if (!button || button.disabled) return;
  auditPage += button.dataset.auditPage === 'next' ? 1 : -1;
  renderAuditLogs();
});
$('#closeAuditDetail')?.addEventListener('click', () => closeModal('auditDetailModal'));
$('#closeAuditDetailButton')?.addEventListener('click', () => closeModal('auditDetailModal'));
$('#auditDetailModal')?.addEventListener('click', (event) => { if ((event.target as HTMLElement).id === 'auditDetailModal') closeModal('auditDetailModal'); });

function openSupplierEditor(supplier?: Supplier) {
  $<HTMLFormElement>('#supplierForm').reset();
  $<HTMLInputElement>('#supplierId').value = supplier?.id ?? '';
  $<HTMLInputElement>('#supplierName').value = supplier?.name ?? '';
  $<HTMLInputElement>('#supplierContact').value = supplier?.contactPerson ?? '';
  $<HTMLInputElement>('#supplierPhone').value = supplier?.phone ?? '';
  $<HTMLInputElement>('#supplierEmail').value = supplier?.email ?? '';
  $<HTMLInputElement>('#supplierAddress').value = supplier?.address ?? '';
  $<HTMLInputElement>('#supplierActive').checked = supplier?.active ?? true;
  $('#supplierModalTitle').textContent = supplier ? 'Edit supplier' : 'Add supplier';
  $('#saveSupplierButton').textContent = supplier ? 'Save changes' : 'Add supplier';
  setModalMsg('supplierFormMessage', '');
  openModal('supplierModal');
  setTimeout(() => $<HTMLInputElement>('#supplierName').focus(), 100);
}

$('#supplierSearch')?.addEventListener('input', () => { supplierPage = 1; renderSuppliers(); });
$('#addSupplierButton')?.addEventListener('click', () => openSupplierEditor());
$('#closeSupplierModal')?.addEventListener('click', () => closeModal('supplierModal'));
$('#cancelSupplierModal')?.addEventListener('click', () => closeModal('supplierModal'));
$('#supplierModal')?.addEventListener('click', (event) => { if ((event.target as HTMLElement).id === 'supplierModal') closeModal('supplierModal'); });
$('#suppliersTable')?.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const sort = target.closest<HTMLButtonElement>('[data-supplier-sort]');
  if (sort) {
    const field = sort.dataset.supplierSort as typeof supplierSort.field;
    supplierSort = { field, direction: supplierSort.field === field ? (supplierSort.direction === 1 ? -1 : 1) : 1 };
    supplierPage = 1; renderSuppliers(); return;
  }
  const edit = target.closest<HTMLButtonElement>('[data-edit-supplier]');
  if (edit) { const supplier = suppliers.find((entry) => entry.id === edit.dataset.editSupplier); if (supplier) openSupplierEditor(supplier); return; }
  const status = target.closest<HTMLButtonElement>('[data-toggle-supplier]');
  if (status) {
    const supplier = suppliers.find((entry) => entry.id === status.dataset.toggleSupplier);
    if (supplier) {
      supplier.active = !supplier.active;
      recordAudit('Suppliers', 'Status changed', `${supplier.name} marked ${supplier.active ? 'active' : 'inactive'}.`);
      save(); renderSuppliers();
    }
  }
});
$('#suppliersPagination')?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-supplier-page]');
  if (!button || button.disabled) return;
  supplierPage += button.dataset.supplierPage === 'next' ? 1 : -1;
  renderSuppliers();
});
$<HTMLFormElement>('#supplierForm')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const id = $<HTMLInputElement>('#supplierId').value;
  const name = $<HTMLInputElement>('#supplierName').value.trim();
  const existing = suppliers.find((supplier) => supplier.id === id);
  if (suppliers.some((supplier) => supplier.id !== id && supplier.name.toLowerCase() === name.toLowerCase())) return setModalMsg('supplierFormMessage', 'A supplier with that name already exists.');
  const supplier: Supplier = {
    id: existing?.id ?? (crypto.randomUUID?.() ?? `supplier-${Date.now()}`), name,
    contactPerson: $<HTMLInputElement>('#supplierContact').value.trim(),
    phone: $<HTMLInputElement>('#supplierPhone').value.trim(),
    email: $<HTMLInputElement>('#supplierEmail').value.trim(),
    address: $<HTMLInputElement>('#supplierAddress').value.trim(),
    active: $<HTMLInputElement>('#supplierActive').checked,
  };
  suppliers = existing ? suppliers.map((entry) => entry.id === id ? supplier : entry) : [...suppliers, supplier];
  recordAudit('Suppliers', existing ? 'Updated' : 'Created', `${supplier.name}${supplier.contactPerson ? ` — contact: ${supplier.contactPerson}` : ''}.`);
  save(); supplierPage = 1; renderSuppliers(); closeModal('supplierModal');
  const message = $('#suppliersMessage'); message.textContent = existing ? 'Supplier details saved.' : 'Supplier added successfully.'; message.className = 'users-message ok';
});

function openUserEditor(user?: User) {
  const form = $<HTMLFormElement>('#userForm');
  form.reset();
  $<HTMLInputElement>('#userId').value = user?.id ?? '';
  $<HTMLInputElement>('#userFirstName').value = user?.firstName ?? '';
  $<HTMLInputElement>('#userLastName').value = user?.lastName ?? '';
  $<HTMLInputElement>('#userEmail').value = user?.email ?? '';
  $<HTMLInputElement>('#userUsername').value = user?.username ?? '';
  $<HTMLSelectElement>('#userRole').value = user?.role ?? 'employee';
  $<HTMLSelectElement>('#userRole').disabled = !!user && (user.id === 'builtin-admin' || user.id === 'builtin-employee');
  $<HTMLInputElement>('#userActive').checked = user?.active ?? true;
  $<HTMLInputElement>('#userPassword').required = !user;
  $('#userModalTitle').textContent = user ? 'Edit user' : 'Add user';
  $('#saveUserButton').textContent = user ? 'Save changes' : 'Add user';
  $('#userPasswordField').style.display = user ? 'none' : '';
  setModalMsg('userFormMessage', '');
  openModal('userModal');
  setTimeout(() => $<HTMLInputElement>('#userFirstName').focus(), 100);
}

$('#userSearch')?.addEventListener('input', () => { userPage = 1; renderUsers(); });
$('#addUserButton')?.addEventListener('click', () => openUserEditor());
$('#closeUserModal')?.addEventListener('click', () => closeModal('userModal'));
$('#cancelUserModal')?.addEventListener('click', () => closeModal('userModal'));
$('#userModal')?.addEventListener('click', (event) => { if ((event.target as HTMLElement).id === 'userModal') closeModal('userModal'); });
$('#usersTable')?.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const sort = target.closest<HTMLButtonElement>('[data-user-sort]');
  if (sort) {
    const field = sort.dataset.userSort as typeof userSort.field;
    userSort = { field, direction: userSort.field === field ? (userSort.direction === 1 ? -1 : 1) : 1 };
    userPage = 1;
    renderUsers();
    return;
  }
  const edit = target.closest<HTMLButtonElement>('[data-edit-user]');
  if (edit) { const user = users.find((entry) => entry.id === edit.dataset.editUser); if (user) openUserEditor(user); return; }
  const remove = target.closest<HTMLButtonElement>('[data-delete-user]');
  if (remove) {
    const user = users.find((entry) => entry.id === remove.dataset.deleteUser);
    if (!user) return;
    if (getSession()?.username === user.username) {
      const message = $('#usersMessage'); message.textContent = 'You cannot delete the account you are currently using.';
      message.className = 'users-message err'; return;
    }
    users = users.filter((entry) => entry.id !== user.id);
    recordAudit('Users', 'Deleted', `User ${user.username} was deleted.`);
    save(); renderUsers();
    const message = $('#usersMessage'); message.textContent = `${user.username} was deleted.`; message.className = 'users-message';
  }
});
$('#usersPagination')?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-user-page]');
  if (!button || button.disabled) return;
  userPage += button.dataset.userPage === 'next' ? 1 : -1;
  renderUsers();
});

$<HTMLFormElement>('#userForm')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const id = $<HTMLInputElement>('#userId').value;
  const username = $<HTMLInputElement>('#userUsername').value.trim();
  const firstName = $<HTMLInputElement>('#userFirstName').value.trim();
  const lastName = $<HTMLInputElement>('#userLastName').value.trim();
  const email = $<HTMLInputElement>('#userEmail').value.trim();
  const role = $<HTMLSelectElement>('#userRole').value as User['role'];
  const password = $<HTMLInputElement>('#userPassword').value;
  const existing = users.find((user) => user.id === id);
  if (users.some((user) => user.id !== id && user.username.toLowerCase() === username.toLowerCase())) return setModalMsg('userFormMessage', 'That username is already in use.');
  if (!existing && password.length < 6) return setModalMsg('userFormMessage', 'Password must be at least 6 characters.');
  if (existing && getSession()?.username === existing.username && !$<HTMLInputElement>('#userActive').checked) return setModalMsg('userFormMessage', 'You cannot deactivate the account you are currently using.');
  const saved: User = { id: existing?.id ?? (crypto.randomUUID?.() ?? `user-${Date.now()}`), username, firstName, lastName, email, role, active: $<HTMLInputElement>('#userActive').checked, password: existing?.password ?? password };
  users = existing ? users.map((user) => user.id === id ? saved : user) : [...users, saved];
  if (existing && getSession()?.username === existing.username && username !== existing.username) localStorage.setItem('wh-session', JSON.stringify({ ...getSession(), username, role }));
  recordAudit('Users', existing ? 'Updated' : 'Created', `User ${saved.username} (${saved.role === 'admin' ? 'Admin' : 'Cashier'}) ${existing ? 'was updated' : 'was created'}.`);
  if (saved.id === 'builtin-admin' || saved.id === 'builtin-employee') {
    const creds = loadCreds();
    const credentialRole = saved.id === 'builtin-admin' ? 'admin' : 'employee';
    creds[credentialRole] = { username: saved.username, password: saved.password };
    saveCreds(creds);
  } else save();
  renderUsers(); closeModal('userModal');
  const message = $('#usersMessage'); message.textContent = existing ? 'User details saved.' : 'User added successfully.'; message.className = 'users-message ok';
});

document.querySelectorAll<HTMLButtonElement>('.toggle button').forEach((btn) =>
  btn.addEventListener('click', () => {
    type = btn.dataset.type as Move;
    document.querySelectorAll('.toggle button').forEach((b) => b.classList.toggle('active', b === btn));
    const s = $<HTMLButtonElement>('.submit');
    s.textContent = type === 'IN' ? 'Save stock in' : 'Save stock out';
    s.classList.toggle('out', type === 'OUT');
    $('#nameRow').style.display = type === 'IN' ? '' : 'none';
    msg.textContent = '';
  }));

$('#inv').addEventListener('click', (e) => {
  const tr = (e.target as HTMLElement).closest<HTMLElement>('tr.pick');
  if (tr) $<HTMLInputElement>('#sku').value = tr.dataset.sku!;
});

$<HTMLFormElement>('#form').addEventListener('submit', (e) => {
  e.preventDefault();
  const sku = $<HTMLInputElement>('#sku').value.trim().toUpperCase();
  const name = $<HTMLInputElement>('#name').value.trim();
  const qty = Math.floor(Number($<HTMLInputElement>('#qty').value));
  const note = $<HTMLInputElement>('#note').value.trim();
  if (!sku || !(qty > 0)) return say('Enter a SKU and a quantity above zero.');

  let it = items.find((i) => i.sku === sku);
  if (type === 'OUT') {
    if (!it) return say(`SKU ${sku} isn't in the warehouse. Log a stock in first.`);
    if (qty > it.qty) return say(`Only ${it.qty} units of ${sku} on hand. Lower the quantity.`);
    it.qty -= qty;
  } else if (it) {
    it.qty += qty;
  } else {
    if (!name) return say('New SKU: add an item name.');
    const free = [...Array(SLOTS).keys()].find((s) => !items.some((i) => i.slot === s));
    if (free === undefined) return say('All rack slots are full. Stock out or clear a SKU first.');
    it = { sku, name, qty, slot: free };
    items.push(it);
  }

  logs.unshift({ id: Date.now(), time: new Date().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }), sku, type, qty, note });
  recordAudit('Inventory', type === 'IN' ? 'Stock in' : 'Stock out', `${qty} units of ${sku} ${type === 'IN' ? 'received' : 'dispatched'}${note ? `; ${note}` : ''}.`);
  save(); renderUI();
  const b = boxes.get(sku);
  if (b) { b.glow = 1; b.userData.flash = type === 'IN' ? 0x3ecf8e : 0xff7a59; }
  say(`${type === 'IN' ? 'Stocked in' : 'Stocked out'} ${qty} × ${sku}.`, true);
  $<HTMLInputElement>('#qty').value = '1'; $<HTMLInputElement>('#note').value = '';
});

/* 3D tilt on panels */
if (!still) document.querySelectorAll<HTMLElement>('.tilt').forEach((el) => {
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `rotateY(${x * 4}deg) rotateX(${-y * 4}deg) translateZ(6px)`;
  });
  el.addEventListener('pointerleave', () => (el.style.transform = ''));
});

/* ---------- Sales workspace ---------- */
let cart: Record<string, number> = {};
let salesMode: 'pos' | 'returns' = 'pos';
const moneylessDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};
const setSalesMessage = (id: string, message: string, ok = false) => {
  const el = $<HTMLParagraphElement>(`#${id}`);
  if (el) { el.textContent = message; el.className = `sales-message${message ? (ok ? ' ok' : ' err') : ''}`; }
};
const cartUnits = () => Object.values(cart).reduce((sum, qty) => sum + qty, 0);

function renderSales() {
  const summary = $('#salesSummary');
  if (!summary) return;
  const orderCount = sales.length;
  const unitsSold = sales.reduce((sum, sale) => sum + sale.lines.reduce((n, line) => n + line.qty, 0), 0);
  const unitsReturned = sales.reduce((sum, sale) => sum + sale.lines.reduce((n, line) => n + line.returned, 0), 0);
  summary.innerHTML = `<div class="summary-metric"><strong>${orderCount}</strong><span>Orders recorded</span></div><div class="summary-metric"><strong>${unitsSold - unitsReturned}</strong><span>Net units sold</span></div>`;

  const search = ($<HTMLInputElement>('#productSearch')?.value ?? '').trim().toLowerCase();
  const matches = items.filter((item) => `${item.sku} ${item.name}`.toLowerCase().includes(search));
  const catalogCount = $('#catalogCount');
  if (catalogCount) catalogCount.textContent = `${matches.length} ${matches.length === 1 ? 'item' : 'items'}`;
  const catalog = $('#productCatalog');
  if (catalog) catalog.innerHTML = matches.length
    ? matches.map((item) => `<article class="product-card ${item.qty <= 0 ? 'unavailable' : ''}">
        <div class="product-mark" aria-hidden="true">${esc(item.name.slice(0, 1).toUpperCase())}</div>
        <div class="product-details"><span class="product-sku">${esc(item.sku)}</span><h3>${esc(item.name)}</h3><span class="stock-status ${item.qty < LOW ? 'stock-low' : ''}"><i></i>${item.qty} in stock</span></div>
        <button type="button" class="add-product" data-add-sku="${esc(item.sku)}" ${item.qty <= (cart[item.sku] ?? 0) ? 'disabled' : ''} aria-label="Add ${esc(item.name)} to order">+</button>
      </article>`).join('')
    : `<div class="sales-empty"><span class="empty-mark">⌕</span><strong>${items.length ? 'No matching products' : 'No inventory yet'}</strong><span>${items.length ? 'Try another name or SKU.' : 'Add stock from the dashboard to start a sale.'}</span></div>`;

  const lines = Object.entries(cart).map(([sku, qty]) => ({ item: items.find((item) => item.sku === sku), qty })).filter((line) => line.item);
  const cartLines = $('#cartLines');
  if (cartLines) cartLines.innerHTML = lines.length
    ? lines.map(({ item, qty }) => `<div class="cart-line" data-cart-line="${esc(item!.sku)}"><div class="cart-line-copy"><strong>${esc(item!.name)}</strong><span>${esc(item!.sku)} · ${item!.qty} available</span></div><div class="quantity-control"><button type="button" data-cart-action="minus" data-cart-sku="${esc(item!.sku)}" aria-label="Remove one ${esc(item!.name)}">−</button><span>${qty}</span><button type="button" data-cart-action="plus" data-cart-sku="${esc(item!.sku)}" aria-label="Add one ${esc(item!.name)}" ${qty >= item!.qty ? 'disabled' : ''}>+</button></div><button type="button" class="remove-line" data-cart-action="remove" data-cart-sku="${esc(item!.sku)}" aria-label="Remove ${esc(item!.name)} from order">×</button></div>`).join('')
    : `<div class="cart-empty"><div class="cart-empty-icon">＋</div><strong>Your order is empty</strong><span>Add products from the catalog to get started.</span></div>`;
  const itemCount = $('#cartItemCount'); if (itemCount) itemCount.textContent = `${lines.length}`;
  const unitCount = $('#cartUnitCount'); if (unitCount) unitCount.textContent = `${cartUnits()}`;
  const checkout = $<HTMLButtonElement>('#completeSale'); if (checkout) checkout.disabled = !lines.length;

  const returnSearch = ($<HTMLInputElement>('#returnSearch')?.value ?? '').trim().toLowerCase();
  const visibleSales = sales.filter((sale) => `${sale.id} ${sale.customer} ${sale.reference} ${sale.lines.map((line) => `${line.sku} ${line.name}`).join(' ')}`.toLowerCase().includes(returnSearch));
  const returnCount = $('#returnCount'); if (returnCount) returnCount.textContent = `${sales.length} ${sales.length === 1 ? 'completed sale' : 'completed sales'}`;
  const history = $('#salesHistory');
  if (history) history.innerHTML = visibleSales.length
    ? visibleSales.map((sale) => `<article class="sale-record"><div class="sale-record-head"><div><span class="sale-order-id">${esc(sale.reference || sale.id)}</span><span class="sale-customer">${esc(sale.customer || 'Walk-in customer')}</span></div><time>${esc(moneylessDate(sale.time))}</time></div><div class="return-lines">${sale.lines.map((line) => {
      const remaining = line.qty - line.returned;
      return `<div class="return-line"><div><strong>${esc(line.name)}</strong><span>${esc(line.sku)} · ${line.returned} of ${line.qty} already returned</span></div>${remaining > 0 ? `<div class="return-action"><label class="sr-only" for="ret-${esc(sale.id)}-${esc(line.sku)}">Return quantity for ${esc(line.name)}</label><input id="ret-${esc(sale.id)}-${esc(line.sku)}" class="return-qty" type="number" min="1" max="${remaining}" value="1" data-return-sale="${esc(sale.id)}" data-return-sku="${esc(line.sku)}" /><button type="button" class="return-button" data-return-sale="${esc(sale.id)}" data-return-sku="${esc(line.sku)}">Restock</button></div>` : `<span class="returned-label">FULLY RETURNED</span>`}</div>`;
    }).join('')}</div></article>`).join('')
    : `<div class="sales-empty"><span class="empty-mark">↩</span><strong>${sales.length ? 'No matching orders' : 'No completed sales yet'}</strong><span>${sales.length ? 'Try another order, customer or SKU.' : 'Completed POS orders will appear here for returns.'}</span></div>`;

  const recent = $('#recentSales');
  if (recent) recent.innerHTML = sales.length
    ? `<thead><tr><th>Order</th><th>Customer</th><th>Date</th><th>Units</th><th>Status</th></tr></thead><tbody>${sales.slice(0, 5).map((sale) => {
        const sold = sale.lines.reduce((sum, line) => sum + line.qty, 0), returned = sale.lines.reduce((sum, line) => sum + line.returned, 0);
        return `<tr><td class="order-cell">${esc(sale.reference || sale.id)}</td><td>${esc(sale.customer || 'Walk-in customer')}</td><td>${esc(moneylessDate(sale.time))}</td><td class="num">${sold}</td><td><span class="sale-status ${returned ? 'has-returns' : ''}">${returned === 0 ? 'Complete' : returned === sold ? 'Returned' : 'Part returned'}</span></td></tr>`;
      }).join('')}</tbody>`
    : `<tbody><tr><td class="sales-table-empty">Your completed sales will appear here.</td></tr></tbody>`;
}

function showSalesView(mode: 'pos' | 'returns') {
  salesMode = mode;
  const posPanel = $('#posPanel'), returnsPanel = $('#returnsPanel'), recentPanel = $('#recentSalesPanel');
  if (posPanel) posPanel.style.display = mode === 'pos' ? '' : 'none';
  if (returnsPanel) returnsPanel.style.display = mode === 'returns' ? '' : 'none';
  if (recentPanel) recentPanel.style.display = mode === 'pos' ? '' : 'none';
  const title = $('#salesPageTitle'); if (title) title.textContent = mode === 'pos' ? 'Point of sale' : 'Sales returns';
  const lead = document.querySelector<HTMLElement>('.sales-lead'); if (lead) lead.textContent = mode === 'pos' ? 'Build an order from available stock and record every dispatch.' : 'Find an order and return eligible items to available stock.';
  document.querySelectorAll<HTMLButtonElement>('.sales-tab').forEach((tab) => {
    const active = tab.dataset.salesView === mode;
    tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active));
  });
  renderSales();
}

$('#productSearch')?.addEventListener('input', renderSales);
$('#returnSearch')?.addEventListener('input', renderSales);
$('#productCatalog')?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-add-sku]');
  if (!button) return;
  const item = items.find((entry) => entry.sku === button.dataset.addSku);
  if (item && (cart[item.sku] ?? 0) < item.qty) { cart[item.sku] = (cart[item.sku] ?? 0) + 1; setSalesMessage('saleMessage', ''); renderSales(); }
});
$('#cartLines')?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-cart-action]');
  if (!button) return;
  const sku = button.dataset.cartSku!, action = button.dataset.cartAction!, item = items.find((entry) => entry.sku === sku);
  if (action === 'remove') delete cart[sku];
  else if (action === 'minus') { cart[sku] = (cart[sku] ?? 0) - 1; if (cart[sku] <= 0) delete cart[sku]; }
  else if (action === 'plus' && item && (cart[sku] ?? 0) < item.qty) cart[sku] = (cart[sku] ?? 0) + 1;
  renderSales();
});
$<HTMLButtonElement>('#completeSale')?.addEventListener('click', () => {
  const lines = Object.entries(cart).map(([sku, qty]) => ({ item: items.find((entry) => entry.sku === sku), qty }));
  const unavailable = lines.find(({ item, qty }) => !item || qty > item.qty);
  if (unavailable) { setSalesMessage('saleMessage', `${unavailable.item?.name ?? 'An item'} no longer has enough stock. Adjust the order and retry.`); renderSales(); return; }
  if (!lines.length) return;
  const saleId = `SO-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${String(Date.now()).slice(-5)}`;
  const time = new Date().toISOString();
  const customer = $<HTMLInputElement>('#saleCustomer').value.trim();
  const reference = $<HTMLInputElement>('#saleReference').value.trim();
  const sale: Sale = { id: saleId, time, customer, reference, lines: lines.map(({ item, qty }) => ({ sku: item!.sku, name: item!.name, qty, returned: 0 })) };
  for (const line of sale.lines) {
    const item = items.find((entry) => entry.sku === line.sku)!;
    item.qty -= line.qty;
    logs.unshift({ id: Date.now() + Math.random(), time: new Date(time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }), sku: line.sku, type: 'OUT', qty: line.qty, note: `Sale ${reference || saleId}` });
  }
  sales.unshift(sale);
  recordAudit('Sales', 'Sale completed', `Order ${reference || saleId} completed with ${sale.lines.length} line item${sale.lines.length === 1 ? '' : 's'}.`);
  cart = {}; save(); renderUI();
  $<HTMLInputElement>('#saleCustomer').value = ''; $<HTMLInputElement>('#saleReference').value = '';
  setSalesMessage('saleMessage', `Sale ${reference || saleId} completed. Inventory has been updated.`, true);
});
$('#salesHistory')?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-return-sale][data-return-sku]');
  if (!button) return;
  const sale = sales.find((entry) => entry.id === button.dataset.returnSale);
  const line = sale?.lines.find((entry) => entry.sku === button.dataset.returnSku);
  const input = button.parentElement?.querySelector<HTMLInputElement>('.return-qty');
  const qty = Math.floor(Number(input?.value));
  if (!sale || !line || !(qty > 0) || qty > line.qty - line.returned) { setSalesMessage('returnMessage', 'Enter a return quantity within the remaining order quantity.'); return; }
  line.returned += qty;
  const item = items.find((entry) => entry.sku === line.sku);
  if (item) item.qty += qty;
  logs.unshift({ id: Date.now(), time: new Date().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }), sku: line.sku, type: 'IN', qty, note: `Return ${sale.reference || sale.id}` });
  recordAudit('Sales', 'Return restocked', `${qty} × ${line.name} returned for order ${sale.reference || sale.id}.`);
  save(); renderUI();
  setSalesMessage('returnMessage', `${qty} × ${line.name} restocked from ${sale.reference || sale.id}.`, true);
});
document.querySelectorAll<HTMLButtonElement>('.sales-tab').forEach((tab) => tab.addEventListener('click', () => showSalesView(tab.dataset.salesView as 'pos' | 'returns')));
$('#viewAllReturns')?.addEventListener('click', () => { showSalesView('returns'); switchView('sales'); });

renderUI();
resize();

/* ---------- Loading Overlay ---------- */
window.addEventListener('load', () => {
  setTimeout(() => {
    const loader = $('#loadingOverlay');
    if (loader) {
      loader.classList.add('hidden');
      setTimeout(() => loader.remove(), 600); // clean up DOM
    }
  }, 800);
});

/* ---------- Logout ---------- */
$('#logoutBtn')?.addEventListener('click', () => {
  recordAudit('Authentication', 'Signed out', 'User signed out.');
  save();
  localStorage.removeItem('wh-session');
  window.location.replace('/');
});

/* ---------- Footer Nav Submenus ---------- */
document.querySelectorAll<HTMLButtonElement>('.nav-item.has-submenu').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent document click from immediately closing it
    
    const group = btn.closest('.nav-group');
    const submenu = group?.querySelector('.nav-submenu');
    
    // Close other submenus
    document.querySelectorAll('.nav-submenu.open').forEach(openSub => {
      if (openSub !== submenu) {
        openSub.classList.remove('open');
        openSub.closest('.nav-group')?.classList.remove('open');
      }
    });

    if (group && submenu) {
      group.classList.toggle('open');
      submenu.classList.toggle('open');
    }
  });
});

// Close submenus when clicking outside
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (!target.closest('.nav-group')) {
    document.querySelectorAll('.nav-submenu.open').forEach(openSub => {
      openSub.classList.remove('open');
      openSub.closest('.nav-group')?.classList.remove('open');
    });
  }
});

/* ---------- Navigation & Views ---------- */
const dashboardView = $('#dashboardView');
const settingsView = $('#settingsView');
const salesView = $('#salesView');
const suppliersView = $('#suppliersView');
const auditLogsView = $('#auditLogsView');
const usersView = $('#usersView');
const navDashboard = $('#navDashboard');
const navSettings = $('#navSettings');
const navSuppliers = $('#navSuppliers');
const navAuditLogs = $('#navAuditLogs');
const navUsers = $('#navUsers');
const salesNavGroup = $('#salesNavGroup');

function switchView(view: 'dashboard' | 'settings' | 'sales' | 'suppliers' | 'auditLogs' | 'users') {
  if (!dashboardView || !settingsView || !salesView || !suppliersView || !auditLogsView || !usersView || !navDashboard || !navSettings) return;
  dashboardView.style.display = view === 'dashboard' ? '' : 'none';
  settingsView.style.display = view === 'settings' ? 'block' : 'none';
  salesView.style.display = view === 'sales' ? '' : 'none';
  suppliersView.style.display = view === 'suppliers' ? '' : 'none';
  auditLogsView.style.display = view === 'auditLogs' ? '' : 'none';
  usersView.style.display = view === 'users' ? '' : 'none';
  navDashboard.classList.toggle('active', view === 'dashboard');
  navSettings.classList.toggle('active', view === 'settings');
  navSuppliers?.classList.toggle('active', view === 'suppliers');
  navAuditLogs?.classList.toggle('active', view === 'auditLogs');
  navUsers?.classList.toggle('active', view === 'users');
  salesNavGroup?.classList.toggle('active', view === 'sales');
  
  if (view === 'settings') {
    // Populate username + role
    const session = JSON.parse(localStorage.getItem('wh-session') ?? 'null');
    const settingUser = $<HTMLElement>('#settingUser');
    const settingRole = $<HTMLElement>('#settingRole');
    if (settingUser && session?.username) settingUser.textContent = session.username;
    if (settingRole && session?.role)     settingRole.textContent = session.role;

    // Populate password (masked by default)
    const creds = loadCreds();
    const role  = session?.role as string;
    const managedUser = users.find((user) => user.username === session?.username);
    const currentPassword = managedUser?.password ?? creds[role]?.password ?? '';
    const passDisplay = $<HTMLElement>('#settingPassDisplay');
    let passRevealed = false;
    if (passDisplay) passDisplay.textContent = '•'.repeat(currentPassword.length || 8);

    // Wire reveal toggle (remove old listener by cloning the button)
    const oldBtn = $<HTMLButtonElement>('#togglePassReveal');
    if (oldBtn) {
      const newBtn = oldBtn.cloneNode(true) as HTMLButtonElement;
      oldBtn.replaceWith(newBtn);
      newBtn.addEventListener('click', () => {
        passRevealed = !passRevealed;
        if (passDisplay) {
          passDisplay.textContent = passRevealed
            ? currentPassword
            : '•'.repeat(currentPassword.length || 8);
        }
        // Swap eye icon
        const eyeSvg = newBtn.querySelector('svg');
        if (eyeSvg) {
          eyeSvg.innerHTML = passRevealed
            ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>'
            : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
        }
        newBtn.style.color = passRevealed ? 'var(--accent)' : 'var(--muted)';
      });
    }
  } else {
    // Re-mask password when leaving settings
    const passDisplay = $<HTMLElement>('#settingPassDisplay');
    if (passDisplay) passDisplay.textContent = '••••••••';
    if (view === 'dashboard') resize(); // Refresh the 3D canvas when returning to the dashboard.
  }
  // Sync URL hash
  if (view === 'settings') {
    if (window.location.hash !== '#settings') window.location.hash = '#settings';
  } else if (view === 'sales') {
    const hash = salesMode === 'returns' ? '#sales-returns' : '#sales-pos';
    if (window.location.hash !== hash) window.location.hash = hash;
  } else if (view === 'users') {
    if (window.location.hash !== '#users') window.location.hash = '#users';
  } else if (view === 'suppliers') {
    if (window.location.hash !== '#suppliers') window.location.hash = '#suppliers';
  } else if (view === 'auditLogs') {
    renderAuditLogs();
    if (window.location.hash !== '#audit-logs') window.location.hash = '#audit-logs';
  } else {
    if (window.location.hash) window.location.hash = '';
  }
}

navDashboard?.addEventListener('click', (e) => {
  e.preventDefault();
  switchView('dashboard');
});

navSettings?.addEventListener('click', (e) => {
  e.preventDefault();
  switchView('settings');
});

navUsers?.addEventListener('click', (e) => {
  e.preventDefault();
  switchView('users');
});

navSuppliers?.addEventListener('click', (e) => {
  e.preventDefault();
  switchView('suppliers');
});

navAuditLogs?.addEventListener('click', (e) => {
  e.preventDefault();
  switchView('auditLogs');
});

document.querySelectorAll<HTMLAnchorElement>('[data-sales-destination]').forEach((link) => link.addEventListener('click', (event) => {
  event.preventDefault();
  showSalesView(link.dataset.salesDestination as 'pos' | 'returns');
  switchView('sales');
  link.closest('.nav-submenu')?.classList.remove('open');
  link.closest('.nav-group')?.classList.remove('open');
}));



$<HTMLButtonElement>('#backToDashboardBtn')?.addEventListener('click', (e) => {
  e.preventDefault();
  switchView('dashboard');
});

// Check URL hash on page load and on popstate/hashchange
function checkInitialHash() {
  if (window.location.hash === '#settings') {
    switchView('settings');
  } else if (window.location.hash === '#users') {
    switchView('users');
  } else if (window.location.hash === '#suppliers') {
    switchView('suppliers');
  } else if (window.location.hash === '#audit-logs') {
    switchView('auditLogs');
  } else if (window.location.hash === '#sales-pos' || window.location.hash === '#sales-returns') {
    showSalesView(window.location.hash === '#sales-returns' ? 'returns' : 'pos');
    switchView('sales');
  } else {
    switchView('dashboard');
  }
}
window.addEventListener('hashchange', checkInitialHash);
checkInitialHash();

function saveCreds(creds: Record<string, { username: string; password: string }>) {
  localStorage.setItem('wh-credentials', JSON.stringify(creds));
  users = users.map((user) => user.id === 'builtin-admin' && creds.admin
    ? { ...user, username: creds.admin.username, password: creds.admin.password }
    : user.id === 'builtin-employee' && creds.employee
      ? { ...user, username: creds.employee.username, password: creds.employee.password }
      : user);
  save();
}
function getSession(): { username: string; role: string } | null {
  try { return JSON.parse(localStorage.getItem('wh-session') ?? 'null'); } catch { return null; }
}

/* ---------- Settings Modals ---------- */
function openModal(id: string) {
  $<HTMLDivElement>(`#${id}`)?.classList.add('open');
}
function closeModal(id: string) {
  $<HTMLDivElement>(`#${id}`)?.classList.remove('open');
}
function setModalMsg(msgId: string, text: string, isOk = false) {
  const el = $<HTMLParagraphElement>(`#${msgId}`);
  if (!el) return;
  el.textContent = text;
  el.className = 'smodal-msg ' + (isOk ? 'ok' : 'err');
}

// Open/close wiring
$('#openChangeUsername')?.addEventListener('click', () => {
  ($<HTMLFormElement>('#usernameForm'))?.reset();
  setModalMsg('unMsg', '');
  openModal('usernameModal');
  setTimeout(() => $<HTMLInputElement>('#unCurrentPass')?.focus(), 100);
});
$('#closeUsernameModal')?.addEventListener('click',  () => closeModal('usernameModal'));
$('#cancelUsernameModal')?.addEventListener('click', () => closeModal('usernameModal'));

$('#openChangePassword')?.addEventListener('click', () => {
  ($<HTMLFormElement>('#passwordForm'))?.reset();
  setModalMsg('pwMsg', '');
  openModal('passwordModal');
  setTimeout(() => $<HTMLInputElement>('#pwCurrentPass')?.focus(), 100);
});
$('#closePasswordModal')?.addEventListener('click',  () => closeModal('passwordModal'));
$('#cancelPasswordModal')?.addEventListener('click', () => closeModal('passwordModal'));

// Close on backdrop click
['usernameModal', 'passwordModal'].forEach(id => {
  $<HTMLDivElement>(`#${id}`)?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === id) closeModal(id);
  });
});

/* ── Change Username ── */
$<HTMLFormElement>('#usernameForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const session = getSession();
  if (!session) return;
  
  const creds  = loadCreds();
  const role   = session.role;
  const stored = creds[role];
  const managedUser = users.find((user) => user.username === session.username);
  const enteredPass = ($<HTMLInputElement>('#unCurrentPass')).value;
  const newName     = ($<HTMLInputElement>('#unNewName')).value.trim();

  if ((!managedUser && !stored) || enteredPass !== (managedUser?.password ?? stored?.password)) {
    return setModalMsg('unMsg', 'Incorrect current password.');
  }
  if (!newName || newName.length < 3) {
    return setModalMsg('unMsg', 'Username must be at least 3 characters.');
  }

  // Update credentials & session
  if (managedUser) {
    managedUser.username = newName;
    if (managedUser.id === 'builtin-admin' || managedUser.id === 'builtin-employee') {
      stored.username = newName;
      saveCreds(creds);
    } else save();
  } else {
    stored.username = newName;
    saveCreds(creds);
  }
  localStorage.setItem('wh-session', JSON.stringify({ ...session, username: newName }));
  recordAudit('Settings', 'Username changed', `Username changed from ${session.username} to ${newName}.`, newName);
  save();

  setModalMsg('unMsg', 'Username updated successfully!', true);
  setTimeout(() => {
    closeModal('usernameModal');
    // Refresh settings display
    const settingUser = $<HTMLElement>('#settingUser');
    if (settingUser) settingUser.textContent = newName;
  }, 1200);
});

/* ── Change Password ── */
$<HTMLFormElement>('#passwordForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const session = getSession();
  if (!session) return;

  const creds      = loadCreds();
  const role       = session.role;
  const stored     = creds[role];
  const managedUser = users.find((user) => user.username === session.username);
  const currentPass = ($<HTMLInputElement>('#pwCurrentPass')).value;
  const newPass     = ($<HTMLInputElement>('#pwNewPass')).value;
  const confirmPass = ($<HTMLInputElement>('#pwConfirmPass')).value;

  if ((!managedUser && !stored) || currentPass !== (managedUser?.password ?? stored?.password)) {
    return setModalMsg('pwMsg', 'Incorrect current password.');
  }
  if (newPass.length < 6) {
    return setModalMsg('pwMsg', 'New password must be at least 6 characters.');
  }
  if (newPass !== confirmPass) {
    return setModalMsg('pwMsg', 'Passwords do not match.');
  }

  if (managedUser) {
    managedUser.password = newPass;
    if (managedUser.id === 'builtin-admin' || managedUser.id === 'builtin-employee') {
      stored.password = newPass;
      saveCreds(creds);
    } else save();
  } else {
    stored.password = newPass;
    saveCreds(creds);
  }

  recordAudit('Settings', 'Password changed', 'Account password was changed.');
  save();

  setModalMsg('pwMsg', 'Password changed successfully!', true);
  setTimeout(() => closeModal('passwordModal'), 1200);
});
