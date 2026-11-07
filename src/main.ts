import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { enablePasswordToggles } from './password-toggle';
import './style.css';
import { supabase } from './supabase';
import { isAdmin } from './access';

enablePasswordToggles();

type Item = {
  sku: string;
  name: string;
  qty: number;
  slot: number;
  price?: number;
};
type Log = {
  id: number;
  time: string;
  sku: string;
  type: 'IN' | 'OUT';
  qty: number;
  note: string;
};
let logs: Log[] = [];
type Move = 'IN' | 'OUT';
type SaleLine = {
  sku: string;
  name: string;
  qty: number;
  returned: number;
  unitPrice?: number;
  saleItemId?: string;
};
type Sale = {
  id: string;
  time: string;
  customer: string;
  reference: string;
  lines: SaleLine[];
  subtotal?: number;
  discountRate?: number;
  vat?: number;
  total?: number;
};

type ReturnEntry = {
  id: string;
  saleId: string;
  sku: string;
  product: string;
  qty: number;
  reason: string;
  handledBy: string;
  status: 'Pending review' | 'Reviewed';
  time: string;
};

type User = {
  id: string;
  username: string;
  role: 'admin' | 'employee';
  firstName: string;
  lastName: string;
  email: string;
  active: boolean;
};
type Supplier = {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  active: boolean;
};
type Category = { id: string; name: string };
type AuditEntry = {
  id: string;
  createdAt: string;
  handledBy: string;
  module: string;
  action: string;
  description: string;
  ipAddress: string;
};

const COLS = 4,
  LEVELS = 3,
  SLOTS = COLS * LEVELS,
  LOW = 10,
  CAP = 200;
const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;

async function loadInventoryHistoryFromSupabase() {
  const { data, error } = await supabase
    .from('inventory_movements')
    .select('id, movement_type, quantity, note, created_at, products(sku)')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Failed to load inventory history from Supabase:', error);
    return;
  }

  if (!data) return;

  logs = data.map((movement) => {
    const product = movement.products as unknown as { sku: string } | null;

    return {
      id: Number(String(movement.id).replace(/\D/g, '').slice(-12)) || 0,
      time: new Date(movement.created_at).toLocaleString([], {
        dateStyle: 'short',
        timeStyle: 'short',
      }),
      sku: product?.sku ?? '',
      type: movement.movement_type === 'stock_in' ? 'IN' : 'OUT',
      qty: Number(movement.quantity),
      note: movement.note ?? '',
    };
  });

  renderUI();
}

async function loadProductsFromSupabase() {
  const { data, error } = await supabase
    .from('products')
    .select('sku, name, stock_quantity, selling_price')
    .order('sku');

  if (error) {
    console.error('Failed to load products from Supabase:', error);
    return;
  }

  if (!data) return;

  items = data.map((product, index) => {
    const existingItem = items.find((item) => item.sku === product.sku);

    return {
      sku: product.sku,
      name: product.name,
      qty: product.stock_quantity,
      slot: existingItem?.slot ?? index,
      price: Number(product.selling_price ?? 0),
    };
  });

  save();
  renderUI();
}

/* ---------- state ---------- */
const seed: Item[] = [
  { sku: 'BLT-001', name: 'Hex bolts M8', qty: 120, slot: 0 },
  { sku: 'PLT-014', name: 'Pallet wrap', qty: 45, slot: 1 },
  { sku: 'BOX-220', name: 'Carton 40x30', qty: 8, slot: 5 },
];
function load<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '') as T;
  } catch {
    return fallback;
  }
}
let users: User[] = [];
let items: Item[] = load('wh-items', seed);

async function loadSalesFromSupabase() {
  const { data: saleRows, error: salesError } = await supabase
    .from('sales')
    .select(
      'id, sale_number, customer_name, reference, subtotal, discount, total, created_at',
    )
    .order('created_at', { ascending: false });

  if (salesError) {
    console.error('Failed to load sales from Supabase:', salesError);
    return;
  }

  if (!saleRows || saleRows.length === 0) {
    sales = [];
    renderUI();
    return;
  }

  const saleIds = saleRows.map((sale) => sale.id);

  const { data: itemRows, error: itemsError } = await supabase
    .from('sale_items')
    .select('id, sale_id, product_id, product_name, quantity, unit_price')
    .in('sale_id', saleIds);

  if (itemsError) {
    console.error('Failed to load sale items from Supabase:', itemsError);
    return;
  }

  const returnedBySaleItemId = new Map<string, number>();

  if (itemRows && itemRows.length > 0) {
    const { data: returnRows, error: returnsError } = await supabase
      .from('returns')
      .select('sale_item_id, quantity')
      .in(
        'sale_item_id',
        itemRows.map((line) => line.id),
      );

    if (returnsError) {
      console.error('Failed to load returned quantities:', returnsError);
      return;
    }

    for (const record of returnRows ?? []) {
      if (!record.sale_item_id) continue;

      const previous = returnedBySaleItemId.get(record.sale_item_id) ?? 0;
      returnedBySaleItemId.set(
        record.sale_item_id,
        previous + Number(record.quantity),
      );
    }
  }

  const { data: productRows, error: productsError } = await supabase
    .from('products')
    .select('id, sku');

  if (productsError) {
    console.error('Failed to load product SKUs for sales:', productsError);
    return;
  }

  const skuByProductId = new Map(
    (productRows ?? []).map((product) => [product.id, product.sku]),
  );

  sales = saleRows.map((row) => {
    const subtotal = Number(row.subtotal ?? 0);
    const discount = Number(row.discount ?? 0);
    const total = Number(row.total ?? 0);

    const saleLines: SaleLine[] = (itemRows ?? [])
      .filter((line) => line.sale_id === row.id)
      .map((line) => ({
        sku: skuByProductId.get(line.product_id) ?? '',
        name: line.product_name,
        qty: Number(line.quantity),
        returned: returnedBySaleItemId.get(line.id) ?? 0,
        unitPrice: Number(line.unit_price),
        saleItemId: line.id,
      }));

    return {
      id: row.id,
      time: row.created_at,
      customer: row.customer_name ?? '',
      reference: row.reference || row.sale_number,
      subtotal,
      discountRate: subtotal > 0 ? (discount / subtotal) * 100 : 0,
      vat: Number((total - subtotal + discount).toFixed(2)),
      total,
      lines: saleLines,
    };
  });

  renderUI();
}

async function loadReturnsFromSupabase() {
  const { data: returnRows, error: returnsError } = await supabase
    .from('returns')
    .select(
      'id, sale_id, sale_item_id, quantity, reason, handled_by, created_at, status',
    )
    .order('created_at', { ascending: false });

  if (returnsError) {
    console.error('Failed to load returns:', returnsError);
    return;
  }

  const saleItemIds = [
    ...new Set(
      (returnRows ?? [])
        .map((row) => row.sale_item_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const saleItemById = new Map<
    string,
    { product_id: string; product_name: string }
  >();

  if (saleItemIds.length > 0) {
    const { data: saleItemRows, error: saleItemsError } = await supabase
      .from('sale_items')
      .select('id, product_id, product_name')
      .in('id', saleItemIds);

    if (saleItemsError) {
      console.error('Failed to load return sale items:', saleItemsError);
      return;
    }

    for (const item of saleItemRows ?? []) {
      saleItemById.set(item.id, {
        product_id: item.product_id,
        product_name: item.product_name,
      });
    }
  }

  const productIds = [
    ...new Set([...saleItemById.values()].map((item) => item.product_id)),
  ];

  const skuByProductId = new Map<string, string>();

  if (productIds.length > 0) {
    const { data: productRows, error: productsError } = await supabase
      .from('products')
      .select('id, sku')
      .in('id', productIds);

    if (productsError) {
      console.error('Failed to load return product SKUs:', productsError);
      return;
    }

    for (const product of productRows ?? []) {
      skuByProductId.set(product.id, product.sku ?? '');
    }
  }

  returnEntries = (returnRows ?? []).map((row) => {
    const saleItem = row.sale_item_id
      ? saleItemById.get(row.sale_item_id)
      : undefined;

    return {
      id: row.id,
      saleId: row.sale_id,
      sku: saleItem ? (skuByProductId.get(saleItem.product_id) ?? '') : '',
      product: saleItem?.product_name ?? 'Unknown product',
      qty: Number(row.quantity),
      reason: row.reason ?? '',
      handledBy: row.handled_by ?? 'Unknown',
      status: row.status as ReturnEntry['status'],
      time: row.created_at,
    };
  });

  renderUI();
}

async function loadSuppliersFromSupabase() {
  const { data, error } = await supabase
    .from('suppliers')
    .select('id, name, contact_person, phone, email, address, active')
    .order('name', { ascending: true });

  if (error) {
    console.error('Failed to load suppliers:', error);
    setModalMsg(
      'supplierFormMessage',
      `Failed to load suppliers: ${error.message}`,
    );
    return;
  }

  suppliers = (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    contactPerson: row.contact_person ?? '',
    phone: row.phone ?? '',
    email: row.email ?? '',
    address: row.address ?? '',
    active: row.active ?? true,
  }));

  renderSuppliers();
}

async function loadCategoriesFromSupabase() {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name')
    .order('name', { ascending: true });

  if (error) {
    console.error('Failed to load categories:', error);
    setModalMsg(
      'categoryFormMessage',
      `Failed to load categories: ${error.message}`,
    );
    return;
  }

  categories = (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
  }));

  renderCategories();
}

async function loadAuditLogsFromSupabase() {
  if (!isAdmin()) return;
  const { data, error } = await supabase
    .from('audit_logs')
    .select('id, user_id, module, action, description, created_at')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    console.error('Failed to load audit logs:', error);
    return;
  }

  const userIds = [
    ...new Set(
      (data ?? [])
        .map((row) => row.user_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const nameById = new Map<string, string>();

  if (userIds.length > 0) {
    const { data: profileRows } = await supabase
      .from('profiles')
      .select('id, username')
      .in('id', userIds);

    for (const profile of profileRows ?? []) {
      nameById.set(profile.id, profile.username ?? '');
    }
  }

  auditEntries = (data ?? []).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    handledBy: (row.user_id && nameById.get(row.user_id)) || 'System',
    module: row.module,
    action: row.action,
    description: row.description,
    ipAddress: 'Unavailable in local browser',
  }));

  renderAuditLogs();
}

async function loadUsersFromSupabase() {
  if (!isAdmin()) return;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, email, first_name, last_name, role, active')
    .order('username', { ascending: true });

  if (error) {
    console.error('Failed to load users:', error);
    return;
  }

  users = (data ?? []).map((row) => ({
    id: row.id,
    username: row.username ?? '',
    role: row.role === 'admin' ? ('admin' as const) : ('employee' as const),
    firstName: row.first_name ?? '',
    lastName: row.last_name ?? '',
    email: row.email ?? '',
    active: row.active ?? true,
  }));

  renderUsers();
}

let sales: Sale[] = [];
let returnEntries: ReturnEntry[] = load('wh-returns', []);
let suppliers: Supplier[] = load('wh-suppliers', []);
let categories: Category[] = load('wh-categories', [
  { id: 'category-tools', name: 'Tools' },
  { id: 'category-constructions', name: 'Constructions' },
  { id: 'category-plumbing', name: 'Plumbing' },
  { id: 'category-electrical', name: 'Electrical' },
  { id: 'category-fixtures', name: 'Fixtures' },
  { id: 'category-others', name: 'Others' },
  { id: 'category-computer-parts', name: 'Computer Parts' },
]);
const storedAuditEntries = isAdmin() ? load<unknown>('wh-audit-logs', []) : [];
let auditEntries: AuditEntry[] = Array.isArray(storedAuditEntries)
  ? storedAuditEntries.filter(
      (entry): entry is AuditEntry =>
        !!entry &&
        typeof entry === 'object' &&
        typeof entry.id === 'string' &&
        typeof entry.createdAt === 'string' &&
        typeof entry.handledBy === 'string' &&
        typeof entry.module === 'string' &&
        typeof entry.action === 'string' &&
        typeof entry.description === 'string' &&
        typeof entry.ipAddress === 'string',
    )
  : [];
let type: Move = 'IN';
const save = () => {
  localStorage.setItem('wh-items', JSON.stringify(items));
  localStorage.setItem('wh-sales', JSON.stringify(sales));
  localStorage.setItem('wh-returns', JSON.stringify(returnEntries));
  if (isAdmin()) localStorage.setItem('wh-users', JSON.stringify(users));
  localStorage.setItem('wh-suppliers', JSON.stringify(suppliers));
  localStorage.setItem('wh-categories', JSON.stringify(categories));
  if (isAdmin())
    localStorage.setItem('wh-audit-logs', JSON.stringify(auditEntries));
};

function recordAudit(
  module: string,
  action: string,
  description: string,
  handledBy?: string,
) {
  const session = getSession();
  auditEntries.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    handledBy: handledBy ?? session?.username ?? 'System',
    module,
    action,
    description,
    ipAddress: 'Unavailable in local browser',
  });
  auditEntries = auditEntries.slice(0, 1000);
  renderAuditLogs();

  // Save a copy to Supabase in the background.
  void (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user.id;
      if (!userId) return;

      const { error } = await supabase
        .from('audit_logs')
        .insert({ user_id: userId, module, action, description });

      if (error) console.error('Failed to save audit log:', error);
    } catch (error) {
      console.error('Unexpected audit log error:', error);
    }
  })();
}

/* ---------- 3D scene ---------- */
const host = $<HTMLDivElement>('#scene');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(Math.max(window.devicePixelRatio || 1, 2), 3));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(6, 5, 9);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2.05;
controls.minDistance = 5;
controls.maxDistance = 20;

scene.background = new THREE.Color(0xeae7e3);
scene.add(new THREE.HemisphereLight(0xffffff, 0xe8e5e0, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(5, 10, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -8;
sun.shadow.camera.right = 8;
sun.shadow.camera.top = 8;
sun.shadow.camera.bottom = -8;
sun.shadow.camera.near = 0.1;
sun.shadow.camera.far = 30;
sun.shadow.bias = -0.0002;
scene.add(sun);
const fill = new THREE.DirectionalLight(0xffffff, 0.4);
fill.position.set(-5, 3, -6);
scene.add(fill);

const floor = new THREE.GridHelper(16, 16, 0xc0bdb8, 0xd4d0cb);
scene.add(floor);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 30),
  new THREE.MeshStandardMaterial({
    color: 0xeae7e3,
    roughness: 1,
    metalness: 0,
  }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.12;
ground.receiveShadow = true;
scene.add(ground);

const W = 1.2,
  GAP = 1.5;
const rackMat = new THREE.MeshStandardMaterial({
  color: 0x888888,
  metalness: 0.7,
  roughness: 0.3,
});
for (let l = 0; l <= LEVELS; l++) {
  const plank = new THREE.Mesh(
    new THREE.BoxGeometry(COLS * W + 0.2, 0.1, W),
    rackMat,
  );
  plank.position.y = l * GAP - 0.05;
  plank.castShadow = true;
  plank.receiveShadow = true;
  scene.add(plank);
}
for (const x of [-1, 1])
  for (const z of [-1, 1]) {
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, LEVELS * GAP, 0.1),
      rackMat,
    );
    post.position.set(
      (x * (COLS * W)) / 2,
      (LEVELS * GAP) / 2 - 0.05,
      z * (W / 2 - 0.05),
    );
    post.castShadow = true;
    post.receiveShadow = true;
    scene.add(post);
  }

const slotXZ = (slot: number) => ({
  x: ((slot % COLS) - (COLS - 1) / 2) * W,
  base: Math.floor(slot / COLS) * GAP,
});
const height = (qty: number) => 0.15 + (Math.min(qty, CAP) / CAP) * 1.1;
const hue = (s: string) =>
  [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7) / 360;
const boxSaturation = 0.3;
const boxLightness = 0.45;

type Box = THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> & {
  cur: number;
  glow: number;
};
const boxes = new Map<string, Box>();
const boxGeo = new THREE.BoxGeometry(1, 1, 1);

function syncBoxes() {
  const skus = new Set(items.map((item) => item.sku));
  for (const [sku, box] of boxes) {
    if (!skus.has(sku)) {
      scene.remove(box);
      box.material.dispose();
      boxes.delete(sku);
    }
  }

  for (const it of items) {
    let b = boxes.get(it.sku);
    if (!b) {
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(
          hue(it.sku),
          boxSaturation,
          boxLightness,
        ),
        roughness: 0.4,
        metalness: 0.3,
      });
      b = Object.assign(new THREE.Mesh(boxGeo, mat), {
        cur: 0.01,
        glow: 1,
      }) as Box;
      b.userData.sku = it.sku;
      b.castShadow = true;
      b.receiveShadow = true;
      scene.add(b);
      boxes.set(it.sku, b);
    }
    b.userData.target = height(it.qty);
    b.material.emissive.set(it.qty < LOW ? 0xc43e2a : 0x000000);
  }
}

const ray = new THREE.Raycaster(),
  mouse = new THREE.Vector2();
const tip = $<HTMLDivElement>('#tip');
function pick(e: PointerEvent): Box | undefined {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1,
  );
  ray.setFromCamera(mouse, camera);
  return ray.intersectObjects([...boxes.values()])[0]?.object as
    Box | undefined;
}
renderer.domElement.addEventListener('pointermove', (e) => {
  const b = pick(e),
    it = items.find((i) => i.sku === b?.userData.sku);
  tip.style.opacity = it ? '1' : '0';
  if (it) {
    tip.textContent = `${it.sku} · ${it.name} · ${it.qty} units`;
    tip.style.left = e.offsetX + 14 + 'px';
    tip.style.top = e.offsetY + 14 + 'px';
  }
});
renderer.domElement.addEventListener('click', (e) => {
  const b = pick(e);
  if (b) {
    $<HTMLInputElement>('#sku').value = b.userData.sku;
    $<HTMLInputElement>('#qty').focus();
  }
});

function resize() {
  const { clientWidth: w, clientHeight: h } = host;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(host);

const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
(function loop() {
  requestAnimationFrame(loop);
  for (const it of items) {
    const b = boxes.get(it.sku);
    if (!b) continue;
    const t = b.userData.target as number;
    b.cur += (t - b.cur) * (still ? 1 : 0.12);
    const { x, base } = slotXZ(it.slot);
    b.scale.set(0.95, b.cur, 0.95);
    b.position.set(x, base + b.cur / 2, 0);
    b.glow *= 0.92;
    b.material.emissiveIntensity = it.qty < LOW ? 0.5 : 0;
    if (b.glow > 0.02)
      b.material.emissive.lerp(
        new THREE.Color(b.userData.flash ?? 0x000000),
        b.glow * 0.3,
      );
  }
  controls.update();
  renderer.render(scene, camera);
})();

/* ---------- UI ---------- */
const msg = $<HTMLParagraphElement>('#msg');
const say = (t: string, ok = false) => {
  msg.textContent = t;
  msg.className = 'msg ' + (ok ? 'ok' : 'err');
};
const esc = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );

function renderUI() {
  const units = items.reduce((a, i) => a + i.qty, 0);
  $('#stats').innerHTML = [
    ['SKUs', items.length],
    ['Units on hand', units],
    ['Low stock', items.filter((i) => i.qty < LOW).length],
  ]
    .map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`)
    .join('');

  $('#skus').innerHTML = items
    .map((i) => `<option value="${esc(i.sku)}">${esc(i.name)}</option>`)
    .join('');

  $('#log').innerHTML = logs.length
    ? `<thead><tr><th>Time</th><th>Type</th><th>SKU</th><th style="text-align:right">Qty</th><th>Note</th></tr></thead><tbody>` +
      logs
        .slice(0, 50)
        .map(
          (
            l,
          ) => `<tr><td>${l.time}</td><td><span class="tag ${l.type}">${l.type}</span></td>
        <td>${esc(l.sku)}</td><td class="num">${l.qty}</td><td>${esc(l.note)}</td></tr>`,
        )
        .join('') +
      '</tbody>'
    : '<tbody><tr><td class="empty">Nothing logged yet.</td></tr></tbody>';

  syncBoxes();
  renderSales();
  renderSuppliers();
  renderCategories();
  renderUsers();
  renderAuditLogs();
}

let userSort: {
  field: keyof Pick<User, 'username' | 'role' | 'email' | 'lastName'>;
  direction: 1 | -1;
} = { field: 'username', direction: 1 };
let userPage = 1;
const USERS_PER_PAGE = 10;
function renderUsers() {
  if (!isAdmin()) return;
  const table = $('#usersTable');
  if (!table) return;
  const search = ($<HTMLInputElement>('#userSearch')?.value ?? '')
    .trim()
    .toLowerCase();
  const visible = users
    .filter((user) => user.username.toLowerCase().includes(search))
    .sort((a, b) => {
      const av = userSort.field === 'lastName' ? a.lastName : a[userSort.field];
      const bv = userSort.field === 'lastName' ? b.lastName : b[userSort.field];
      return String(av).localeCompare(String(bv)) * userSort.direction;
    });
  const pageCount = Math.max(1, Math.ceil(visible.length / USERS_PER_PAGE));
  userPage = Math.min(userPage, pageCount);
  const pageUsers = visible.slice(
    (userPage - 1) * USERS_PER_PAGE,
    userPage * USERS_PER_PAGE,
  );
  const count = $('#userCount');
  if (count)
    count.textContent = `${users.length} ${users.length === 1 ? 'user' : 'users'}`;
  const headers: Array<[string, string]> = [
    ['username', 'Username'],
    ['role', 'Role'],
    ['email', 'Email'],
    ['lastName', 'Last name'],
  ];
  table.innerHTML = pageUsers.length
    ? `<thead><tr>${headers.map(([field, label]) => `<th><button type="button" class="user-sort" data-user-sort="${field}">${label}<span aria-hidden="true">${userSort.field === field ? (userSort.direction === 1 ? '↑' : '↓') : '↕'}</span></button></th>`).join('')}<th>Status</th><th class="user-actions-heading">Actions</th></tr></thead><tbody>${pageUsers
        .map(
          (user) => `<tr>
        <td class="user-name-cell">${esc(user.username)}</td><td>${user.role === 'admin' ? 'Admin' : 'Cashier'}</td><td>${esc(user.email)}</td><td>${esc(user.lastName)}</td>
        <td><span class="user-status ${user.active ? 'is-active' : 'is-inactive'}">${user.active ? 'Active' : 'Inactive'}</span></td>
        <td class="user-actions"><button type="button" class="user-edit" data-edit-user="${esc(user.id)}" aria-label="Edit ${esc(user.username)}" title="Edit user"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 4 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/></svg></button><button type="button" class="user-delete" data-delete-user="${esc(user.id)}" aria-label="Delete ${esc(user.username)}" title="Delete user"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg></button></td>
      </tr>`,
        )
        .join('')}</tbody>`
    : `<tbody><tr><td class="users-empty" colspan="6">${users.length ? 'No users match that username.' : 'No users have been added yet.'}</td></tr></tbody>`;
  const pagination = $('#usersPagination');
  if (pagination) {
    const from = visible.length ? (userPage - 1) * USERS_PER_PAGE + 1 : 0;
    const to = Math.min(userPage * USERS_PER_PAGE, visible.length);
    pagination.innerHTML = `<span class="users-pagination-summary">Showing ${from}–${to} of ${visible.length}</span><div class="users-pagination-actions"><button type="button" data-user-page="prev" ${userPage <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${userPage} of ${pageCount}</span><button type="button" data-user-page="next" ${userPage >= pageCount ? 'disabled' : ''}>Next</button></div>`;
  }
}

let supplierSort: {
  field: keyof Pick<
    Supplier,
    'name' | 'contactPerson' | 'phone' | 'email' | 'address'
  >;
  direction: 1 | -1;
} = { field: 'name', direction: 1 };
let supplierPage = 1;
const SUPPLIERS_PER_PAGE = 10;

function renderSuppliers() {
  const table = $('#suppliersTable');
  if (!table) return;
  const search = ($<HTMLInputElement>('#supplierSearch')?.value ?? '')
    .trim()
    .toLowerCase();
  const visible = suppliers
    .filter((supplier) => supplier.name.toLowerCase().includes(search))
    .sort(
      (a, b) =>
        a[supplierSort.field].localeCompare(b[supplierSort.field]) *
        supplierSort.direction,
    );
  const pageCount = Math.max(1, Math.ceil(visible.length / SUPPLIERS_PER_PAGE));
  supplierPage = Math.min(supplierPage, pageCount);
  const pageSuppliers = visible.slice(
    (supplierPage - 1) * SUPPLIERS_PER_PAGE,
    supplierPage * SUPPLIERS_PER_PAGE,
  );
  const columns: Array<[typeof supplierSort.field, string]> = [
    ['name', 'Name'],
    ['contactPerson', 'Contact Person'],
    ['phone', 'Phone Number'],
    ['email', 'Email'],
    ['address', 'Address'],
  ];
  table.innerHTML = pageSuppliers.length
    ? `<thead><tr>${columns.map(([field, label]) => `<th><button type="button" class="user-sort" data-supplier-sort="${field}">${label}<span aria-hidden="true">${supplierSort.field === field ? (supplierSort.direction === 1 ? '↑' : '↓') : '↕'}</span></button></th>`).join('')}<th>Status</th></tr></thead><tbody>${pageSuppliers
        .map(
          (supplier) => `<tr>
        <td><button type="button" class="supplier-name-button" data-edit-supplier="${esc(supplier.id)}">${esc(supplier.name)}</button></td>
        <td class="supplier-contact-cell" title="${esc(supplier.contactPerson)}">${esc(supplier.contactPerson)}</td><td>${esc(supplier.phone)}</td><td>${esc(supplier.email)}</td><td>${esc(supplier.address)}</td>

<td>
  <button
    type="button"
    class="user-status ${supplier.active ? 'is-active' : 'is-inactive'}"
    data-toggle-supplier="${esc(supplier.id)}"
    aria-label="Set ${esc(supplier.name)} ${supplier.active ? 'inactive' : 'active'}"
  >
    ${supplier.active ? 'Active' : 'Inactive'}
  </button>
  <button
    type="button"
    class="user-delete"
    data-delete-supplier="${esc(supplier.id)}"
    aria-label="Delete ${esc(supplier.name)}"
    title="Delete supplier"
  >
    Delete
  </button>
</td>
      </tr>`,
        )
        .join('')}</tbody>`
    : `<tbody><tr><td class="users-empty" colspan="6">${suppliers.length ? 'No suppliers match that name.' : 'No suppliers yet. Add your first supplier to get started.'}</td></tr></tbody>`;
  const pagination = $('#suppliersPagination');
  if (pagination) {
    const from = visible.length
      ? (supplierPage - 1) * SUPPLIERS_PER_PAGE + 1
      : 0;
    const to = Math.min(supplierPage * SUPPLIERS_PER_PAGE, visible.length);
    pagination.innerHTML = `<span class="users-pagination-summary">Showing ${from}–${to} of ${visible.length}</span><div class="users-pagination-actions"><button type="button" data-supplier-page="prev" ${supplierPage <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${supplierPage} of ${pageCount}</span><button type="button" data-supplier-page="next" ${supplierPage >= pageCount ? 'disabled' : ''}>Next</button></div>`;
  }
}

let categorySortDirection: 1 | -1 = 1;
let categoryPage = 1;
const CATEGORIES_PER_PAGE = 7;
function renderCategories() {
  const table = $('#categoriesTable');
  if (!table) return;
  const search = ($<HTMLInputElement>('#categorySearch')?.value ?? '')
    .trim()
    .toLowerCase();
  const visible = categories.filter((category) =>
    category.name.toLowerCase().includes(search),
  );
  if (categorySortDirection === -1) visible.reverse();
  const pageCount = Math.max(
    1,
    Math.ceil(visible.length / CATEGORIES_PER_PAGE),
  );
  categoryPage = Math.min(categoryPage, pageCount);
  const pageCategories = visible.slice(
    (categoryPage - 1) * CATEGORIES_PER_PAGE,
    categoryPage * CATEGORIES_PER_PAGE,
  );
  table.innerHTML = pageCategories.length
    ? `<thead><tr><th><button type="button" class="user-sort" data-category-sort>Name<span aria-hidden="true">${categorySortDirection === 1 ? '↕' : '↓'}</span></button></th><th class="user-actions-heading">Actions</th></tr></thead><tbody>${pageCategories.map((category) => `<tr><td>${esc(category.name)}</td><td class="user-actions"><button type="button" class="user-edit" data-edit-category="${esc(category.id)}" aria-label="Edit ${esc(category.name)}" title="Edit category"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 4 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/></svg></button><button type="button" class="user-delete" data-delete-category="${esc(category.id)}" aria-label="Delete ${esc(category.name)}" title="Delete category"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg></button></td></tr>`).join('')}</tbody>`
    : `<tbody><tr><td class="users-empty" colspan="2">${categories.length ? 'No categories match your search.' : 'No categories yet. Add a category to get started.'}</td></tr></tbody>`;
  const pagination = $('#categoriesPagination');
  if (pagination) {
    pagination.innerHTML = `<div class="users-pagination-actions"><button type="button" data-category-page="prev" ${categoryPage <= 1 ? 'disabled' : ''}>Previous</button><button type="button" data-category-page="next" ${categoryPage >= pageCount ? 'disabled' : ''}>Next</button></div>`;
  }
}

let auditSort: { field: keyof AuditEntry; direction: 1 | -1 } = {
  field: 'createdAt',
  direction: -1,
};
let auditPage = 1;
const AUDIT_PAGE_SIZE = 10;
const auditDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
};
function renderAuditLogs() {
  if (!isAdmin()) return;
  const table = $('#auditTable');
  if (!table) return;
  const moduleFilter = ($<HTMLInputElement>('#auditSearch')?.value ?? '')
    .trim()
    .toLowerCase();
  const visible = auditEntries
    .filter((entry) => entry.module.toLowerCase().includes(moduleFilter))
    .sort((a, b) => {
      const comparison =
        auditSort.field === 'createdAt'
          ? a.createdAt.localeCompare(b.createdAt)
          : a[auditSort.field].localeCompare(b[auditSort.field]);
      return comparison * auditSort.direction;
    });
  const pageCount = Math.max(1, Math.ceil(visible.length / AUDIT_PAGE_SIZE));
  auditPage = Math.min(auditPage, pageCount);
  const pageEntries = visible.slice(
    (auditPage - 1) * AUDIT_PAGE_SIZE,
    auditPage * AUDIT_PAGE_SIZE,
  );
  const columns: Array<[keyof AuditEntry, string]> = [
    ['createdAt', 'Created at'],
    ['handledBy', 'Handled by'],
    ['module', 'Module'],
    ['action', 'Action'],
    ['description', 'Description'],
    ['ipAddress', 'IP Address'],
  ];
  table.innerHTML = pageEntries.length
    ? `<thead><tr>${columns.map(([field, label]) => `<th><button type="button" class="user-sort" data-audit-sort="${field}">${label}<span aria-hidden="true">${auditSort.field === field ? (auditSort.direction === 1 ? '↑' : '↓') : '↕'}</span></button></th>`).join('')}<th class="audit-actions-heading">Actions</th></tr></thead><tbody>${pageEntries
        .map(
          (entry) => `<tr>
        <td>${esc(auditDate(entry.createdAt))}</td><td>${esc(entry.handledBy)}</td><td><span class="audit-module-tag">${esc(entry.module)}</span></td><td>${esc(entry.action)}</td>
        <td class="audit-description-cell" title="${esc(entry.description)}">${esc(entry.description)}</td><td title="IP address is not exposed by this local browser app">${esc(entry.ipAddress || '—')}</td>
        <td class="audit-actions-cell"><button type="button" class="audit-view-button" data-audit-detail="${esc(entry.id)}" aria-label="View audit details">View</button></td>
      </tr>`,
        )
        .join('')}</tbody>`
    : `<thead><tr>${columns.map(([field, label]) => `<th><button type="button" class="user-sort" data-audit-sort="${field}">${label}<span aria-hidden="true">${auditSort.field === field ? (auditSort.direction === 1 ? '↑' : '↓') : '↕'}</span></button></th>`).join('')}<th>Actions</th></tr></thead><tbody><tr><td class="audit-no-results" colspan="7">No results.</td></tr></tbody>`;
  const pagination = $('#auditPagination');
  if (pagination) {
    const from = visible.length ? (auditPage - 1) * AUDIT_PAGE_SIZE + 1 : 0;
    const to = Math.min(auditPage * AUDIT_PAGE_SIZE, visible.length);
    pagination.innerHTML = `<span class="users-pagination-summary">Showing ${from}–${to} of ${visible.length}</span><div class="users-pagination-actions"><button type="button" data-audit-page="prev" ${auditPage <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${auditPage} of ${pageCount}</span><button type="button" data-audit-page="next" ${auditPage >= pageCount ? 'disabled' : ''}>Next</button></div>`;
  }
}

$('#auditSearch')?.addEventListener('input', () => {
  auditPage = 1;
  renderAuditLogs();
});
$('#auditTable')?.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const sort = target.closest<HTMLButtonElement>('[data-audit-sort]');
  if (sort) {
    const field = sort.dataset.auditSort as keyof AuditEntry;
    auditSort = {
      field,
      direction:
        auditSort.field === field
          ? auditSort.direction === 1
            ? -1
            : 1
          : field === 'createdAt'
            ? -1
            : 1,
    };
    auditPage = 1;
    renderAuditLogs();
    return;
  }
  const view = target.closest<HTMLButtonElement>('[data-audit-detail]');
  if (view) {
    const entry = auditEntries.find(
      (item) => item.id === view.dataset.auditDetail,
    );
    if (!entry) return;
    const details: Array<[string, string]> = [
      ['Created at', auditDate(entry.createdAt)],
      ['Handled by', entry.handledBy],
      ['Module', entry.module],
      ['Action', entry.action],
      ['Description', entry.description],
      ['IP address', entry.ipAddress || 'Unavailable in local browser'],
    ];
    $('#auditDetailContent').innerHTML = details
      .map(
        ([label, value]) =>
          `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`,
      )
      .join('');
    openModal('auditDetailModal');
  }
});
$('#auditPagination')?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    '[data-audit-page]',
  );
  if (!button || button.disabled) return;
  auditPage += button.dataset.auditPage === 'next' ? 1 : -1;
  renderAuditLogs();
});
$('#closeAuditDetail')?.addEventListener('click', () =>
  closeModal('auditDetailModal'),
);
$('#closeAuditDetailButton')?.addEventListener('click', () =>
  closeModal('auditDetailModal'),
);
$('#auditDetailModal')?.addEventListener('click', (event) => {
  if ((event.target as HTMLElement).id === 'auditDetailModal')
    closeModal('auditDetailModal');
});

function openSupplierEditor(supplier?: Supplier) {
  $<HTMLFormElement>('#supplierForm').reset();
  $<HTMLInputElement>('#supplierId').value = supplier?.id ?? '';
  $<HTMLInputElement>('#supplierName').value = supplier?.name ?? '';
  $<HTMLInputElement>('#supplierContact').value = supplier?.contactPerson ?? '';
  $<HTMLInputElement>('#supplierPhone').value = supplier?.phone ?? '';
  $<HTMLInputElement>('#supplierEmail').value = supplier?.email ?? '';
  $<HTMLInputElement>('#supplierAddress').value = supplier?.address ?? '';
  $<HTMLInputElement>('#supplierActive').checked = supplier?.active ?? true;
  $('#supplierModalTitle').textContent = supplier
    ? 'Edit supplier'
    : 'Add supplier';
  $('#saveSupplierButton').textContent = supplier
    ? 'Save changes'
    : 'Add supplier';
  setModalMsg('supplierFormMessage', '');
  openModal('supplierModal');
  setTimeout(() => $<HTMLInputElement>('#supplierName').focus(), 100);
}

$('#supplierSearch')?.addEventListener('input', () => {
  supplierPage = 1;
  renderSuppliers();
});
$('#addSupplierButton')?.addEventListener('click', () => openSupplierEditor());
$('#closeSupplierModal')?.addEventListener('click', () =>
  closeModal('supplierModal'),
);
$('#cancelSupplierModal')?.addEventListener('click', () =>
  closeModal('supplierModal'),
);
$('#supplierModal')?.addEventListener('click', (event) => {
  if ((event.target as HTMLElement).id === 'supplierModal')
    closeModal('supplierModal');
});
$('#suppliersTable')?.addEventListener('click', async (event) => {
  const target = event.target as HTMLElement;

  const remove = target.closest<HTMLButtonElement>('[data-delete-supplier]');

  if (remove) {
    const supplier = suppliers.find(
      (entry) => entry.id === remove.dataset.deleteSupplier,
    );

    if (
      !supplier ||
      !window.confirm(
        `Delete supplier "${supplier.name}"? This cannot be undone.`,
      )
    ) {
      return;
    }

    remove.disabled = true;

    try {
      const { error } = await supabase
        .from('suppliers')
        .delete()
        .eq('id', supplier.id);

      if (error) throw error;

      suppliers = suppliers.filter((entry) => entry.id !== supplier.id);

      recordAudit('Suppliers', 'Deleted', `${supplier.name} supplier deleted.`);

      save();
      renderSuppliers();

      const message = $('#suppliersMessage');
      if (message) {
        message.textContent = 'Supplier deleted successfully.';
        message.className = 'users-message ok';
      }
    } catch (error) {
      console.error('Failed to delete supplier:', error);
      alert(
        'Failed to delete supplier. It may be referenced by other records.',
      );
    } finally {
      remove.disabled = false;
    }
  }

  const sort = target.closest<HTMLButtonElement>('[data-supplier-sort]');
  if (sort) {
    const field = sort.dataset.supplierSort as typeof supplierSort.field;
    supplierSort = {
      field,
      direction:
        supplierSort.field === field
          ? supplierSort.direction === 1
            ? -1
            : 1
          : 1,
    };
    supplierPage = 1;
    renderSuppliers();
    return;
  }
  const edit = target.closest<HTMLButtonElement>('[data-edit-supplier]');
  if (edit) {
    const supplier = suppliers.find(
      (entry) => entry.id === edit.dataset.editSupplier,
    );
    if (supplier) openSupplierEditor(supplier);
    return;
  }

  const status = target.closest<HTMLButtonElement>('[data-toggle-supplier]');

  if (status) {
    const supplier = suppliers.find(
      (entry) => entry.id === status.dataset.toggleSupplier,
    );

    if (!supplier) return;

    const newStatus = !supplier.active;
    status.disabled = true;

    try {
      const { error } = await supabase
        .from('suppliers')
        .update({ active: newStatus })
        .eq('id', supplier.id);

      if (error) throw error;

      supplier.active = newStatus;

      recordAudit(
        'Suppliers',
        'Status changed',
        `${supplier.name} marked ${newStatus ? 'active' : 'inactive'}.`,
      );

      save();
      renderSuppliers();
    } catch (error) {
      console.error('Failed to update supplier status:', error);
      alert('Failed to update supplier status. Please try again.');
    } finally {
      status.disabled = false;
    }
  }
});

$('#suppliersPagination')?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    '[data-supplier-page]',
  );
  if (!button || button.disabled) return;
  supplierPage += button.dataset.supplierPage === 'next' ? 1 : -1;
  renderSuppliers();
});

$<HTMLFormElement>('#supplierForm')?.addEventListener(
  'submit',
  async (event) => {
    event.preventDefault();

    const id = $<HTMLInputElement>('#supplierId').value;
    const name = $<HTMLInputElement>('#supplierName').value.trim();
    const existing = suppliers.find((supplier) => supplier.id === id);

    if (!name) {
      return setModalMsg('supplierFormMessage', 'Enter a supplier name.');
    }

    if (
      suppliers.some(
        (supplier) =>
          supplier.id !== id &&
          supplier.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      return setModalMsg(
        'supplierFormMessage',
        'A supplier with that name already exists.',
      );
    }

    const supplier: Supplier = {
      id: existing?.id ?? crypto.randomUUID?.() ?? `supplier-${Date.now()}`,
      name,
      contactPerson: $<HTMLInputElement>('#supplierContact').value.trim(),
      phone: $<HTMLInputElement>('#supplierPhone').value.trim(),
      email: $<HTMLInputElement>('#supplierEmail').value.trim(),
      address: $<HTMLInputElement>('#supplierAddress').value.trim(),
      active: $<HTMLInputElement>('#supplierActive').checked,
    };

    const supplierData = {
      name: supplier.name,
      contact_person: supplier.contactPerson,
      phone: supplier.phone,
      email: supplier.email,
      address: supplier.address,
    };

    const submitButton = $<HTMLFormElement>(
      '#supplierForm',
    ).querySelector<HTMLButtonElement>('button[type="submit"]');

    if (submitButton) submitButton.disabled = true;

    try {
      const result = existing
        ? await supabase
            .from('suppliers')
            .update(supplierData)
            .eq('id', existing.id)
        : await supabase.from('suppliers').insert(supplierData);

      if (result.error) {
        console.error('Failed to save supplier:', result.error);
        setModalMsg(
          'supplierFormMessage',
          `Failed to save supplier: ${result.error.message}`,
        );
        return;
      }

      await loadSuppliersFromSupabase();

      recordAudit(
        'Suppliers',
        existing ? 'Updated' : 'Created',
        `${supplier.name}${supplier.contactPerson ? ` — contact: ${supplier.contactPerson}` : ''}.`,
      );

      save();
      supplierPage = 1;
      renderSuppliers();
      closeModal('supplierModal');

      const message = $('#suppliersMessage');
      if (message) {
        message.textContent = existing
          ? 'Supplier details saved.'
          : 'Supplier added successfully.';
        message.className = 'users-message ok';
      }
    } catch (error) {
      console.error('Unexpected supplier save error:', error);
      setModalMsg(
        'supplierFormMessage',
        'Something went wrong while saving the supplier.',
      );
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  },
);

function openCategoryEditor(category?: Category) {
  $<HTMLFormElement>('#categoryForm').reset();
  $<HTMLInputElement>('#categoryId').value = category?.id ?? '';
  $<HTMLInputElement>('#categoryName').value = category?.name ?? '';
  $('#categoryModalTitle').textContent = category
    ? 'Edit category'
    : 'Add category';
  $('#saveCategoryButton').textContent = category
    ? 'Save changes'
    : 'Add category';
  setModalMsg('categoryFormMessage', '');
  openModal('categoryModal');
  setTimeout(() => $<HTMLInputElement>('#categoryName').focus(), 100);
}

$('#categorySearch')?.addEventListener('input', () => {
  categoryPage = 1;
  renderCategories();
});
$('#addCategoryButton')?.addEventListener('click', () => openCategoryEditor());
$('#closeCategoryModal')?.addEventListener('click', () =>
  closeModal('categoryModal'),
);
$('#cancelCategoryModal')?.addEventListener('click', () =>
  closeModal('categoryModal'),
);
$('#categoryModal')?.addEventListener('click', (event) => {
  if ((event.target as HTMLElement).id === 'categoryModal')
    closeModal('categoryModal');
});
$('#categoriesTable')?.addEventListener('click', async (event) => {
  const target = event.target as HTMLElement;
  if (target.closest('[data-category-sort]')) {
    categorySortDirection = categorySortDirection === 1 ? -1 : 1;
    renderCategories();
    return;
  }
  const edit = target.closest<HTMLButtonElement>('[data-edit-category]');
  if (edit) {
    const category = categories.find(
      (entry) => entry.id === edit.dataset.editCategory,
    );
    if (category) openCategoryEditor(category);
    return;
  }

  const remove = target.closest<HTMLButtonElement>('[data-delete-category]');

  if (!remove) return;

  const category = categories.find(
    (entry) => entry.id === remove.dataset.deleteCategory,
  );

  if (!category || !window.confirm(`Delete category “${category.name}”?`)) {
    return;
  }

  remove.disabled = true;

  try {
    const { error } = await supabase
      .from('categories')
      .delete()
      .eq('id', category.id);

    if (error) throw error;

    categories = categories.filter((entry) => entry.id !== category.id);

    recordAudit(
      'Inventory',
      'Category deleted',
      `${category.name} category deleted.`,
    );

    save();
    renderCategories();
  } catch (error) {
    console.error('Failed to delete category:', error);
    alert('Failed to delete category. Please try again.');
  } finally {
    remove.disabled = false;
  }
});

$('#categoriesPagination')?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    '[data-category-page]',
  );
  if (!button || button.disabled) return;
  categoryPage += button.dataset.categoryPage === 'next' ? 1 : -1;
  renderCategories();
});

$<HTMLFormElement>('#categoryForm')?.addEventListener(
  'submit',
  async (event) => {
    event.preventDefault();

    const id = $<HTMLInputElement>('#categoryId').value;
    const name = $<HTMLInputElement>('#categoryName').value.trim();
    const existing = categories.find((category) => category.id === id);

    if (!name) {
      return setModalMsg('categoryFormMessage', 'Enter a category name.');
    }

    if (
      categories.some(
        (category) =>
          category.id !== id &&
          category.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      return setModalMsg(
        'categoryFormMessage',
        'That category already exists.',
      );
    }

    const category: Category = {
      id: existing?.id ?? crypto.randomUUID?.() ?? `category-${Date.now()}`,
      name,
    };

    const submitButton = $<HTMLFormElement>(
      '#categoryForm',
    ).querySelector<HTMLButtonElement>('button[type="submit"]');

    if (submitButton) submitButton.disabled = true;

    try {
      const result = existing
        ? await supabase
            .from('categories')
            .update({ name })
            .eq('id', existing.id)
        : await supabase.from('categories').insert({ name });

      if (result.error) {
        console.error('Failed to save category:', result.error);
        setModalMsg(
          'categoryFormMessage',
          `Failed to save category: ${result.error.message}`,
        );
        return;
      }

      await loadCategoriesFromSupabase();

      recordAudit(
        'Inventory',
        existing ? 'Category updated' : 'Category created',
        `${category.name} category ${existing ? 'updated' : 'created'}.`,
      );

      save();
      categoryPage = 1;
      renderCategories();
      closeModal('categoryModal');

      const message = $('#categoriesMessage');
      if (message) {
        message.textContent = existing
          ? 'Category updated.'
          : 'Category added.';
        message.className = 'users-message ok';
      }
    } catch (error) {
      console.error('Unexpected category save error:', error);
      setModalMsg(
        'categoryFormMessage',
        'Something went wrong while saving the category.',
      );
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  },
);

function openUserEditor(user?: User) {
  if (!isAdmin()) return;
  const form = $<HTMLFormElement>('#userForm');
  form.reset();
  $<HTMLInputElement>('#userId').value = user?.id ?? '';
  $<HTMLInputElement>('#userFirstName').value = user?.firstName ?? '';
  $<HTMLInputElement>('#userLastName').value = user?.lastName ?? '';
  $<HTMLInputElement>('#userEmail').value = user?.email ?? '';
  $<HTMLInputElement>('#userEmail').readOnly = !!user;
  $<HTMLInputElement>('#userUsername').value = user?.username ?? '';
  $<HTMLSelectElement>('#userRole').value = user?.role ?? 'employee';
  $<HTMLSelectElement>('#userRole').disabled =
    !!user && (user.id === 'builtin-admin' || user.id === 'builtin-employee');
  $<HTMLInputElement>('#userActive').checked = user?.active ?? true;
  $<HTMLInputElement>('#userPassword').required = !user;
  $('#userModalTitle').textContent = user ? 'Edit user' : 'Add user';
  $('#saveUserButton').textContent = user ? 'Save changes' : 'Add user';
  $('#userPasswordField').style.display = user ? 'none' : '';
  setModalMsg('userFormMessage', '');
  openModal('userModal');
  setTimeout(() => $<HTMLInputElement>('#userFirstName').focus(), 100);
}

$('#userSearch')?.addEventListener('input', () => {
  userPage = 1;
  renderUsers();
});
$('#addUserButton')?.addEventListener('click', () => openUserEditor());
$('#closeUserModal')?.addEventListener('click', () => closeModal('userModal'));
$('#cancelUserModal')?.addEventListener('click', () => closeModal('userModal'));
$('#userModal')?.addEventListener('click', (event) => {
  if ((event.target as HTMLElement).id === 'userModal') closeModal('userModal');
});
$('#usersTable')?.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const sort = target.closest<HTMLButtonElement>('[data-user-sort]');
  if (sort) {
    const field = sort.dataset.userSort as typeof userSort.field;
    userSort = {
      field,
      direction:
        userSort.field === field ? (userSort.direction === 1 ? -1 : 1) : 1,
    };
    userPage = 1;
    renderUsers();
    return;
  }
  const edit = target.closest<HTMLButtonElement>('[data-edit-user]');
  if (edit) {
    const user = users.find((entry) => entry.id === edit.dataset.editUser);
    if (user) openUserEditor(user);
    return;
  }

  const remove = target.closest<HTMLButtonElement>('[data-delete-user]');
  if (remove) {
    const user = users.find((entry) => entry.id === remove.dataset.deleteUser);
    if (!user) return;
    const message = $('#usersMessage');
    message.textContent =
      getSession()?.username === user.username
        ? 'You cannot delete the account you are currently using.'
        : `Users can't be deleted from the app. Set ${user.username} to Inactive to block access, or remove the account in Supabase (Authentication → Users).`;
    message.className = 'users-message err';
    return;
  }
});

$('#usersPagination')?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    '[data-user-page]',
  );
  if (!button || button.disabled) return;
  userPage += button.dataset.userPage === 'next' ? 1 : -1;
  renderUsers();
});

$<HTMLFormElement>('#userForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!isAdmin()) return;

  const id = $<HTMLInputElement>('#userId').value;
  const username = $<HTMLInputElement>('#userUsername').value.trim();
  const firstName = $<HTMLInputElement>('#userFirstName').value.trim();
  const lastName = $<HTMLInputElement>('#userLastName').value.trim();
  const role = $<HTMLSelectElement>('#userRole').value as User['role'];
  const active = $<HTMLInputElement>('#userActive').checked;
  const existing = users.find((user) => user.id === id);

  if (username.length < 3) {
    return setModalMsg(
      'userFormMessage',
      'Username must be at least 3 characters.',
    );
  }

  if (
    users.some(
      (user) =>
        user.id !== id &&
        user.username.toLowerCase() === username.toLowerCase(),
    )
  ) {
    return setModalMsg('userFormMessage', 'That username is already in use.');
  }

  const currentSession = getSession();
  const isSelf = !!existing && currentSession?.username === existing.username;

  if (isSelf && !active) {
    return setModalMsg(
      'userFormMessage',
      'You cannot deactivate the account you are currently using.',
    );
  }

  if (isSelf && role !== 'admin') {
    return setModalMsg(
      'userFormMessage',
      'You cannot remove your own admin role.',
    );
  }

  const submitButton = $<HTMLFormElement>(
    '#userForm',
  ).querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;

  try {
    if (!existing) {
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: {
          email: $<HTMLInputElement>('#userEmail').value.trim(),
          password: $<HTMLInputElement>('#userPassword').value,
          username,
          firstName,
          lastName,
          role,
          active,
        },
      });
      if (error || !data?.user) {
        let detail =
          'Unable to create user. Check that the create-user function is deployed and you are signed in as an active admin.';
        if (error?.context instanceof Response) {
          const response = error.context;
          const result = await response.json().catch(() => null);
          if (response.status === 404) {
            detail =
              'The create-user function is missing from your Supabase project. Deploy it before adding users.';
          } else if (typeof result?.error === 'string') {
            detail = result.error;
          } else if (response.status === 401) {
            detail =
              'Your session could not be verified. Sign out, then sign in through the Admin tab and try again.';
          } else if (typeof result?.message === 'string') {
            detail = `Unable to create user: ${result.message}`;
          }
        }
        return setModalMsg('userFormMessage', detail);
      }
      $<HTMLInputElement>('#userPassword').value = '';
      closeModal('userModal');
      await loadUsersFromSupabase();
      recordAudit('Users', 'Created', `User ${username} was created.`);
      const message = $('#usersMessage');
      message.textContent =
        'User created in Supabase. They can sign in using their email and password when active.';
      message.className = 'users-message ok';
      return;
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        username,
        first_name: firstName,
        last_name: lastName,
        role,
        active,
      })
      .eq('id', id);

    if (error) {
      console.error('Failed to update user:', error);
      return setModalMsg(
        'userFormMessage',
        `Failed to save user: ${error.message}`,
      );
    }

    if (isSelf && username !== existing.username) {
      localStorage.setItem(
        'wh-session',
        JSON.stringify({ ...currentSession, username, role }),
      );
    }

    await loadUsersFromSupabase();

    recordAudit(
      'Users',
      'Updated',
      `User ${username} (${role === 'admin' ? 'Admin' : 'Cashier'}) was updated.`,
    );
    save();
    closeModal('userModal');

    const message = $('#usersMessage');
    message.textContent = 'User details saved.';
    message.className = 'users-message ok';
  } catch (error) {
    console.error('Unexpected user save error:', error);
    setModalMsg(
      'userFormMessage',
      'Something went wrong while saving the user.',
    );
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
});

document.querySelectorAll<HTMLButtonElement>('.toggle button').forEach((btn) =>
  btn.addEventListener('click', () => {
    type = btn.dataset.type as Move;
    document
      .querySelectorAll('.toggle button')
      .forEach((b) => b.classList.toggle('active', b === btn));
    const s = $<HTMLButtonElement>('.submit');
    s.textContent = type === 'IN' ? 'Save stock in' : 'Save stock out';
    s.classList.toggle('out', type === 'OUT');
    $('#nameRow').style.display = type === 'IN' ? '' : 'none';
    msg.textContent = '';
  }),
);

$<HTMLFormElement>('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const sku = $<HTMLInputElement>('#sku').value.trim().toUpperCase();
  const name = $<HTMLInputElement>('#name').value.trim();
  const qty = Math.floor(Number($<HTMLInputElement>('#qty').value));
  const note = $<HTMLInputElement>('#note').value.trim();
  if (!sku || !(qty > 0)) return say('Enter a SKU and a quantity above zero.');

  let it = items.find((i) => i.sku === sku);
  let freeSlot: number | undefined;

  if (!it) {
    if (type === 'OUT') {
      return say(`SKU ${sku} isn't in the warehouse. Log a stock in first.`);
    }

    if (!name) {
      return say('New SKU: add an item name.');
    }

    freeSlot = [...Array(SLOTS).keys()].find(
      (s) => !items.some((i) => i.slot === s),
    );

    if (freeSlot === undefined) {
      return say('All rack slots are full. Stock out or clear a SKU first.');
    }
  } else if (type === 'OUT' && qty > it.qty) {
    return say(`Only ${it.qty} units of ${sku} on hand. Lower the quantity.`);
  }

  const { data, error } = await supabase.rpc('record_stock_movement', {
    p_sku: sku,
    p_type: type === 'IN' ? 'stock_in' : 'stock_out',
    p_quantity: qty,
    p_note: note || null,
    p_name: name || null,
  });

  if (error || !data) {
    console.error('Stock movement failed:', error);
    return say('Could not save stock movement. Please try again.');
  }

  const saved = data as {
    sku: string;
    name: string;
    stock_quantity: number;
  };

  if (it) {
    it.qty = saved.stock_quantity;
  } else {
    it = {
      sku: saved.sku,
      name: saved.name,
      qty: saved.stock_quantity,
      slot: freeSlot!,
      price: 0,
    };

    items.push(it);
  }

  await loadInventoryHistoryFromSupabase();
  recordAudit(
    'Inventory',
    type === 'IN' ? 'Stock in' : 'Stock out',
    `${qty} units of ${sku} ${type === 'IN' ? 'received' : 'dispatched'}${note ? `; ${note}` : ''}.`,
  );
  save();
  renderUI();
  const b = boxes.get(sku);
  if (b) {
    b.glow = 1;
    b.userData.flash = type === 'IN' ? 0x3ecf8e : 0xff7a59;
  }
  say(`${type === 'IN' ? 'Stocked in' : 'Stocked out'} ${qty} × ${sku}.`, true);
  $<HTMLInputElement>('#qty').value = '1';
  $<HTMLInputElement>('#note').value = '';
});

/* 3D tilt on panels */
if (!still)
  document.querySelectorAll<HTMLElement>('.tilt').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5,
        y = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `rotateY(${x * 4}deg) rotateX(${-y * 4}deg) translateZ(6px)`;
    });
    el.addEventListener('pointerleave', () => (el.style.transform = ''));
  });

/* ---------- Sales workspace ---------- */
let cart: Record<string, number> = {};
let salesMode: 'pos' | 'returns' = 'pos';
const moneylessDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};
const setSalesMessage = (id: string, message: string, ok = false) => {
  const el = $<HTMLParagraphElement>(`#${id}`);
  if (el) {
    el.textContent = message;
    el.className = `sales-message${message ? (ok ? ' ok' : ' err') : ''}`;
  }
};
const currency = (amount: number) => `₱${amount.toFixed(2)}`;
const cartUnits = () => Object.values(cart).reduce((sum, qty) => sum + qty, 0);

function renderSales() {
  const summary = $('#salesSummary');
  if (!summary) return;
  const orderCount = sales.length;
  const unitsSold = sales.reduce(
    (sum, sale) => sum + sale.lines.reduce((n, line) => n + line.qty, 0),
    0,
  );
  const unitsReturned = sales.reduce(
    (sum, sale) => sum + sale.lines.reduce((n, line) => n + line.returned, 0),
    0,
  );
  summary.innerHTML = `<div class="summary-metric"><strong>${orderCount}</strong><span>Orders recorded</span></div><div class="summary-metric"><strong>${unitsSold - unitsReturned}</strong><span>Net units sold</span></div>`;

  const search = ($<HTMLInputElement>('#productSearch')?.value ?? '')
    .trim()
    .toLowerCase();
  const sortBy = $<HTMLSelectElement>('#productSort')?.value ?? 'name';
  const matches = items
    .filter((item) => `${item.sku} ${item.name}`.toLowerCase().includes(search))
    .sort((a, b) =>
      sortBy === 'sku'
        ? a.sku.localeCompare(b.sku)
        : sortBy === 'stock'
          ? b.qty - a.qty
          : a.name.localeCompare(b.name),
    );
  const catalogCount = $('#catalogCount');
  if (catalogCount)
    catalogCount.textContent = `${matches.length} ${matches.length === 1 ? 'item' : 'items'}`;
  const catalog = $('#productCatalog');
  if (catalog)
    catalog.innerHTML = matches.length
      ? matches
          .map(
            (
              item,
            ) => `<article class="product-card ${item.qty <= 0 ? 'unavailable' : ''}">
        <span class="stock-badge ${item.qty <= 0 ? 'sold-out' : ''}">${item.qty <= 0 ? 'Sold out' : 'In stock'}</span>
        <div class="product-mark" aria-hidden="true">${esc(item.name.slice(0, 1).toUpperCase())}</div>
        <div class="product-details"><span class="product-sku">${esc(item.sku)}</span><h3>${esc(item.name)}</h3><span class="stock-status ${item.qty < LOW ? 'stock-low' : ''}"><i></i>${item.qty} units available</span></div>
        <label class="product-price-label">Unit price<input class="product-price" type="number" min="0" step="0.01" value="${Number(item.price ?? 0).toFixed(2)}" data-price-sku="${esc(item.sku)}" aria-label="Unit price for ${esc(item.name)}" /></label>
        <button type="button" class="add-product" data-add-sku="${esc(item.sku)}" ${item.qty <= (cart[item.sku] ?? 0) ? 'disabled' : ''} aria-label="Add ${esc(item.name)} to order">+</button>
      </article>`,
          )
          .join('')
      : `<div class="sales-empty"><span class="empty-mark">⌕</span><strong>${items.length ? 'No matching products' : 'No inventory yet'}</strong><span>${items.length ? 'Try another name or SKU.' : 'Add stock from the dashboard to start a sale.'}</span></div>`;

  const lines = Object.entries(cart)
    .map(([sku, qty]) => ({
      item: items.find((item) => item.sku === sku),
      qty,
    }))
    .filter((line) => line.item);
  const cartLines = $('#cartLines');
  if (cartLines)
    cartLines.innerHTML = lines.length
      ? lines
          .map(
            ({ item, qty }) =>
              `<div class="cart-line" data-cart-line="${esc(item!.sku)}"><div class="cart-line-copy"><strong>${esc(item!.name)}</strong><span>${esc(item!.sku)}</span></div><div class="quantity-control"><button type="button" data-cart-action="minus" data-cart-sku="${esc(item!.sku)}" aria-label="Remove one ${esc(item!.name)}">−</button><span>${qty}</span><button type="button" data-cart-action="plus" data-cart-sku="${esc(item!.sku)}" aria-label="Add one ${esc(item!.name)}" ${qty >= item!.qty ? 'disabled' : ''}>+</button></div><label class="sr-only" for="cart-price-${esc(item!.sku)}">Unit price for ${esc(item!.name)}</label><input id="cart-price-${esc(item!.sku)}" class="cart-price" type="number" min="0" step="0.01" value="${Number(item!.price ?? 0).toFixed(2)}" data-price-sku="${esc(item!.sku)}" /><strong class="cart-line-total">${currency(Number(item!.price ?? 0) * qty)}</strong><button type="button" class="remove-line" data-cart-action="remove" data-cart-sku="${esc(item!.sku)}" aria-label="Remove ${esc(item!.name)} from order">×</button></div>`,
          )
          .join('')
      : `<div class="cart-empty"><div class="cart-empty-icon">＋</div><strong>Your order is empty</strong><span>Add products from the catalog to get started.</span></div>`;
  const itemCount = $('#cartItemCount');
  if (itemCount) itemCount.textContent = `${lines.length}`;
  const unitCount = $('#cartUnitCount');
  if (unitCount) unitCount.textContent = `${cartUnits()}`;
  const subtotal = lines.reduce(
    (sum, { item, qty }) => sum + Number(item!.price ?? 0) * qty,
    0,
  );
  const discountInput = $<HTMLInputElement>('#discountRate');
  const discountRate = Math.max(
    0,
    Math.min(100, Number(discountInput?.value ?? 0) || 0),
  );
  if (discountInput && Number(discountInput.value) !== discountRate)
    discountInput.value = `${discountRate}`;
  const discount = (subtotal * discountRate) / 100;
  const vat = (subtotal - discount) * 0.12;
  const total = subtotal - discount + vat;
  const subtotalNode = $('#cartSubtotal');
  if (subtotalNode) subtotalNode.textContent = currency(subtotal);
  const discountNode = $('#cartDiscount');
  if (discountNode) discountNode.textContent = currency(discount);
  const vatNode = $('#cartVat');
  if (vatNode) vatNode.textContent = currency(vat);
  const totalNode = $('#cartTotal');
  if (totalNode) totalNode.textContent = currency(total);
  const checkout = $<HTMLButtonElement>('#completeSale');
  if (checkout)
    checkout.disabled =
      !lines.length || lines.some(({ item }) => !(Number(item!.price) > 0));
  const priceMissing = lines.some(({ item }) => !(Number(item!.price) > 0));
  if (priceMissing)
    setSalesMessage(
      'saleMessage',
      'Set a unit price for each product before payment.',
    );
  else if (
    $('#saleMessage')?.textContent ===
    'Set a unit price for each product before payment.'
  )
    setSalesMessage('saleMessage', '');

  const returnSearch = ($<HTMLInputElement>('#returnSearch')?.value ?? '')
    .trim()
    .toLowerCase();
  const visibleSales = sales.filter((sale) =>
    `${sale.id} ${sale.customer} ${sale.reference} ${sale.lines.map((line) => `${line.sku} ${line.name}`).join(' ')}`
      .toLowerCase()
      .includes(returnSearch),
  );
  const returnCount = $('#returnCount');
  if (returnCount)
    returnCount.textContent = `${sales.length} ${sales.length === 1 ? 'completed sale' : 'completed sales'}`;
  const history = $('#salesHistory');
  if (history)
    history.innerHTML = visibleSales.length
      ? visibleSales
          .map(
            (sale) =>
              `<article class="sale-record"><div class="sale-record-head"><div><span class="sale-order-id">${esc(sale.reference || sale.id)}</span><span class="sale-customer">${esc(sale.customer || 'Walk-in customer')}</span></div><time>${esc(moneylessDate(sale.time))}</time></div><div class="return-lines">${sale.lines
                .map((line) => {
                  const remaining = line.qty - line.returned;
                  return `<div class="return-line"><div><strong>${esc(line.name)}</strong><span>${esc(line.sku)} · ${line.returned} of ${line.qty} already returned</span></div>${remaining > 0 ? `<div class="return-action"><label class="sr-only" for="ret-${esc(sale.id)}-${esc(line.sku)}">Return quantity for ${esc(line.name)}</label><input id="ret-${esc(sale.id)}-${esc(line.sku)}" class="return-qty" type="number" min="1" max="${remaining}" value="1" data-return-sale="${esc(sale.id)}" data-return-sku="${esc(line.sku)}" /><label class="sr-only" for="reason-${esc(sale.id)}-${esc(line.sku)}">Return reason</label><input id="reason-${esc(sale.id)}-${esc(line.sku)}" class="return-reason" maxlength="120" placeholder="Reason" data-return-reason="${esc(sale.id)}-${esc(line.sku)}" /><button type="button" class="return-button" data-return-sale="${esc(sale.id)}" data-return-sku="${esc(line.sku)}">Return item</button></div>` : `<span class="returned-label">FULLY RETURNED</span>`}</div>`;
                })
                .join('')}</div></article>`,
          )
          .join('')
      : `<div class="sales-empty"><span class="empty-mark">↩</span><strong>${sales.length ? 'No matching orders' : 'No completed sales yet'}</strong><span>${sales.length ? 'Try another order, customer or SKU.' : 'Completed POS orders will appear here for returns.'}</span></div>`;

  const returnRegister = $('#returnRegister');
  if (returnRegister)
    returnRegister.innerHTML = returnEntries.length
      ? `<thead><tr><th>Date</th><th>Returned product</th><th>Qty</th><th>Reason</th><th>Handled by</th><th>Status</th><th>Action</th></tr></thead><tbody>${returnEntries
          .slice()
          .sort((a, b) => b.time.localeCompare(a.time))
          .map(
            (entry) =>
              `<tr><td>${esc(moneylessDate(entry.time))}</td><td>${esc(entry.product)}</td><td class="num">${entry.qty}</td><td>${esc(entry.reason)}</td><td>${esc(entry.handledBy)}</td><td><span class="return-status ${entry.status === 'Reviewed' ? 'reviewed' : ''}">${esc(entry.status)}</span></td><td>${entry.status === 'Reviewed' ? '—' : `<button type="button" class="review-return" data-review-return="${esc(entry.id)}">Mark reviewed</button>`}</td></tr>`,
          )
          .join('')}</tbody>`
      : `<tbody><tr><td class="sales-table-empty" colspan="7">No returned items have been recorded yet.</td></tr></tbody>`;

  const recent = $('#recentSales');
  if (recent)
    recent.innerHTML = sales.length
      ? `<thead><tr><th>Order</th><th>Customer</th><th>Date</th><th>Units</th><th>Status</th></tr></thead><tbody>${sales
          .slice(0, 5)
          .map((sale) => {
            const sold = sale.lines.reduce((sum, line) => sum + line.qty, 0),
              returned = sale.lines.reduce(
                (sum, line) => sum + line.returned,
                0,
              );
            return `<tr><td class="order-cell">${esc(sale.reference || sale.id)}</td><td>${esc(sale.customer || 'Walk-in customer')}</td><td>${esc(moneylessDate(sale.time))}</td><td class="num">${sold}</td><td><span class="sale-status ${returned ? 'has-returns' : ''}">${returned === 0 ? 'Complete' : returned === sold ? 'Returned' : 'Part returned'}</span></td></tr>`;
          })
          .join('')}</tbody>`
      : `<tbody><tr><td class="sales-table-empty">Your completed sales will appear here.</td></tr></tbody>`;
}

function showSalesView(mode: 'pos' | 'returns') {
  salesMode = mode;
  const posPanel = $('#posPanel'),
    returnsPanel = $('#returnsPanel'),
    recentPanel = $('#recentSalesPanel');
  if (posPanel) posPanel.style.display = mode === 'pos' ? '' : 'none';
  if (returnsPanel)
    returnsPanel.style.display = mode === 'returns' ? '' : 'none';
  if (recentPanel) recentPanel.style.display = mode === 'pos' ? '' : 'none';
  const title = $('#salesPageTitle');
  if (title)
    title.textContent = mode === 'pos' ? 'Point of sale' : 'Sales returns';
  const lead = salesView?.querySelector<HTMLElement>('.sales-lead');
  if (lead)
    lead.textContent =
      mode === 'pos'
        ? 'Build an order from available stock and record every dispatch.'
        : 'Find a completed sale and record returned items for restocking.';
  document.querySelectorAll<HTMLButtonElement>('.sales-tab').forEach((tab) => {
    const active = tab.dataset.salesView === mode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  renderSales();
}

$('#productSearch')?.addEventListener('input', renderSales);
$('#productSort')?.addEventListener('change', renderSales);
$('#returnSearch')?.addEventListener('input', renderSales);
$('#discountRate')?.addEventListener('input', renderSales);
document.addEventListener('change', (event) => {
  const input = (event.target as HTMLElement).closest<HTMLInputElement>(
    '[data-price-sku]',
  );
  if (!input) return;
  const item = items.find((entry) => entry.sku === input.dataset.priceSku);
  const price = Number(input.value);
  if (!item || !Number.isFinite(price) || price < 0) return;
  item.price = price;
  save();
  renderSales();
});
$('#productCatalog')?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    '[data-add-sku]',
  );
  if (!button) return;
  const item = items.find((entry) => entry.sku === button.dataset.addSku);
  if (item && (cart[item.sku] ?? 0) < item.qty) {
    cart[item.sku] = (cart[item.sku] ?? 0) + 1;
    setSalesMessage('saleMessage', '');
    renderSales();
  }
});
$('#cartLines')?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    '[data-cart-action]',
  );
  if (!button) return;
  const sku = button.dataset.cartSku!,
    action = button.dataset.cartAction!,
    item = items.find((entry) => entry.sku === sku);
  if (action === 'remove') delete cart[sku];
  else if (action === 'minus') {
    cart[sku] = (cart[sku] ?? 0) - 1;
    if (cart[sku] <= 0) delete cart[sku];
  } else if (action === 'plus' && item && (cart[sku] ?? 0) < item.qty)
    cart[sku] = (cart[sku] ?? 0) + 1;
  renderSales();
});
$('#clearCart')?.addEventListener('click', () => {
  cart = {};
  setSalesMessage('saleMessage', '');
  renderSales();
});

$<HTMLButtonElement>('#completeSale')?.addEventListener('click', async () => {
  const lines = Object.entries(cart).map(([sku, qty]) => ({
    item: items.find((entry) => entry.sku === sku),
    qty,
  }));

  const unavailable = lines.find(
    ({ item, qty }) => !item || qty <= 0 || qty > item.qty,
  );

  if (unavailable) {
    setSalesMessage(
      'saleMessage',
      `${unavailable.item?.name ?? 'An item'} no longer has enough stock. Adjust the order and retry.`,
    );
    renderSales();
    return;
  }

  if (!lines.length) return;

  if (lines.some(({ item }) => !(Number(item!.price) > 0))) {
    setSalesMessage(
      'saleMessage',
      'Set a unit price for each product before payment.',
    );
    return;
  }

  const saleNumber = `SO-${new Date()
    .toISOString()
    .slice(2, 10)
    .replace(/-/g, '')}-${String(Date.now()).slice(-5)}`;

  const time = new Date().toISOString();
  const customer = $<HTMLInputElement>('#saleCustomer').value.trim();
  const reference = $<HTMLInputElement>('#saleReference').value.trim();
  const discountRate = Math.max(
    0,
    Math.min(100, Number($<HTMLInputElement>('#discountRate').value) || 0),
  );

  setSalesMessage('saleMessage', '');

  const { data, error } = await supabase.rpc('complete_pos_sale', {
    p_sale_number: saleNumber,
    p_customer_name: customer,
    p_reference: reference,
    p_discount_rate: discountRate,
    p_lines: lines.map(({ item, qty }) => ({
      sku: item!.sku,
      qty,
    })),
  });

  if (error) {
    console.error('Checkout failed:', error);
    setSalesMessage('saleMessage', `Checkout failed: ${error.message}`);
    return;
  }

  if (!data?.sale_id) {
    setSalesMessage(
      'saleMessage',
      'The sale response was incomplete. Check Supabase before retrying.',
    );
    return;
  }

  const subtotal = Number(data.subtotal);
  const vat = Number(data.vat);
  const total = Number(data.total);

  const sale: Sale = {
    id: String(data.sale_id),
    time,
    customer,
    reference: reference || saleNumber,
    subtotal,
    discountRate,
    vat,
    total,
    lines: lines.map(({ item, qty }) => ({
      sku: item!.sku,
      name: item!.name,
      qty,
      returned: 0,
      unitPrice: Number(item!.price),
    })),
  };

  sales.unshift(sale);

  recordAudit(
    'Sales',
    'Sale completed',
    `Order ${saleNumber} completed with ${sale.lines.length} line item${sale.lines.length === 1 ? '' : 's'}.`,
  );

  cart = {};
  save();
  await loadSalesFromSupabase();

  $<HTMLInputElement>('#saleCustomer').value = '';
  $<HTMLInputElement>('#saleReference').value = '';
  $<HTMLInputElement>('#discountRate').value = '0';

  try {
    await loadProductsFromSupabase();
    await loadInventoryHistoryFromSupabase();
  } catch (refreshError) {
    console.error('Sale succeeded, but refreshing data failed:', refreshError);
  }

  renderUI();

  setSalesMessage(
    'saleMessage',
    `Sale ${saleNumber} completed! Total: ₱${total.toFixed(2)}.`,
    true,
  );
});

$('#salesHistory')?.addEventListener('click', async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    '[data-return-sale][data-return-sku]',
  );
  if (!button) return;

  const sale = sales.find((entry) => entry.id === button.dataset.returnSale);
  const line = sale?.lines.find(
    (entry) => entry.sku === button.dataset.returnSku,
  );

  const input =
    button.parentElement?.querySelector<HTMLInputElement>('.return-qty');
  const reasonInput =
    button.parentElement?.querySelector<HTMLInputElement>('.return-reason');

  const qty = Math.floor(Number(input?.value));
  const reason = reasonInput?.value.trim() ?? '';

  if (
    !sale ||
    !line ||
    !line.saleItemId ||
    !(qty > 0) ||
    qty > line.qty - line.returned
  ) {
    setSalesMessage(
      'returnMessage',
      'Enter a return quantity within the remaining order quantity.',
    );
    return;
  }

  if (!reason) {
    setSalesMessage('returnMessage', 'Enter a reason for the return.');
    reasonInput?.focus();
    return;
  }

  // Prevent duplicate clicks while the database request is running.
  button.disabled = true;

  try {
    const { error } = await supabase.rpc('process_pos_return', {
      p_sale_item_id: line.saleItemId,
      p_quantity: qty,
      p_reason: reason,
    });

    if (error) {
      console.error('Failed to process return:', error);
      setSalesMessage('returnMessage', `Return failed: ${error.message}`);
      return;
    }

    // The database recorded the return request; stock is restored only after Admin approval.
    // Reload the authoritative data instead of incrementing local stock.
    await Promise.all([
      loadProductsFromSupabase(),
      loadInventoryHistoryFromSupabase(),
      loadSalesFromSupabase(),
    ]);

    recordAudit(
      'Sales',
      'Return request submitted',
      `${qty} × ${line.name} requested for return on order ${sale.reference || sale.id}. Awaiting Admin approval.`,
    );

    save();

    setSalesMessage(
      'returnMessage',
      `Return request submitted! ${qty} × ${line.name} for order ${sale.reference || sale.id} is pending Admin review. Stock will be restored after approval.`,
      true,
    );
  } catch (error) {
    console.error('Unexpected return error:', error);
    setSalesMessage(
      'returnMessage',
      'Something went wrong while processing the return. Check the database before retrying.',
    );
  } finally {
    button.disabled = false;
  }
});

$('#returnRegister')?.addEventListener('click', async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    '[data-review-return]',
  );

  if (!button) return;

  const entry = returnEntries.find(
    (record) => record.id === button.dataset.reviewReturn,
  );

  if (!entry) return;

  if (entry.status === 'Reviewed') return;

  button.disabled = true;

  try {
    const { error } = await supabase.rpc('approve_pos_return', {
      p_return_id: entry.id,
    });

    if (error) {
      console.error('Failed to approve return:', error);
      setSalesMessage(
        'returnMessage',
        `Could not approve return: ${error.message}`,
      );
      return;
    }

    await Promise.all([
      loadReturnsFromSupabase(),
      loadProductsFromSupabase(),
      loadInventoryHistoryFromSupabase(),
      loadSalesFromSupabase(),
    ]);

    recordAudit(
      'Returns',
      'Return approved',
      `${entry.qty} × ${entry.product} approved and returned to stock.`,
    );

    save();
    renderUI();

    setSalesMessage(
      'returnMessage',
      `Return approved! ${entry.qty} × ${entry.product} has been added back to stock.`,
      true,
    );
  } catch (error) {
    console.error('Unexpected return approval error:', error);

    setSalesMessage(
      'returnMessage',
      'Something went wrong. Check the return status and stock in Supabase before retrying.',
    );
  } finally {
    button.disabled = false;
  }
});

document
  .querySelectorAll<HTMLButtonElement>('.sales-tab')
  .forEach((tab) =>
    tab.addEventListener('click', () =>
      showSalesView(tab.dataset.salesView as 'pos' | 'returns'),
    ),
  );
$('#viewAllReturns')?.addEventListener('click', () => {
  showSalesView('returns');
  switchView('sales');
});

/* ---------- Logout ---------- */
$('#logoutBtn')?.addEventListener('click', async () => {
  recordAudit('Authentication', 'Signed out', 'User signed out.');
  save();

  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error('Supabase sign-out failed:', error);
  }

  localStorage.removeItem('wh-session');
  window.location.replace('/');
});

/* ---------- Footer Nav Submenus ---------- */
document
  .querySelectorAll<HTMLButtonElement>('.nav-item.has-submenu')
  .forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent document click from immediately closing it

      const group = btn.closest('.nav-group');
      const submenu = group?.querySelector('.nav-submenu');

      // Close other submenus
      document.querySelectorAll('.nav-submenu.open').forEach((openSub) => {
        if (openSub !== submenu) {
          openSub.classList.remove('open');
          const openGroup = openSub.closest('.nav-group');
          openGroup?.classList.remove('open');
          openGroup
            ?.querySelector<HTMLButtonElement>('.nav-item.has-submenu')
            ?.setAttribute('aria-expanded', 'false');
        }
      });

      if (group && submenu) {
        const isOpen = !submenu.classList.contains('open');
        group.classList.toggle('open', isOpen);
        submenu.classList.toggle('open', isOpen);
        btn.setAttribute('aria-expanded', String(isOpen));
      }
    });
  });

// Close submenus when clicking outside
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (!target.closest('.nav-group')) {
    document.querySelectorAll('.nav-submenu.open').forEach((openSub) => {
      openSub.classList.remove('open');
      const openGroup = openSub.closest('.nav-group');
      openGroup?.classList.remove('open');
      openGroup
        ?.querySelector<HTMLButtonElement>('.nav-item.has-submenu')
        ?.setAttribute('aria-expanded', 'false');
    });
  }
});

/* ---------- Navigation & Views ---------- */
const dashboardView = $('#dashboardView');
const movementView = $('#movementView');
const settingsView = $('#settingsView');
const salesView = $('#salesView');
const suppliersView = $('#suppliersView');
const categoriesView = $('#categoriesView');
const auditLogsView = $('#auditLogsView');
const usersView = $('#usersView');
const navDashboard = $('#navDashboard');
const navSettings = $('#navSettings');
const navSuppliers = $('#navSuppliers');
const navAuditLogs = $('#navAuditLogs');
const navUsers = $('#navUsers');
const salesNavGroup = $('#salesNavGroup');
const inventoryNavGroup = $('#inventoryNavGroup');

function switchView(
  view:
    | 'dashboard'
    | 'movement'
    | 'categories'
    | 'settings'
    | 'sales'
    | 'suppliers'
    | 'auditLogs'
    | 'users',
) {
  if (!isAdmin() && (view === 'users' || view === 'auditLogs')) {
    view = 'dashboard';
    window.history.replaceState(
      null,
      '',
      window.location.pathname + window.location.search,
    );
  }
  if (
    !dashboardView ||
    !movementView ||
    !settingsView ||
    !salesView ||
    !suppliersView ||
    !categoriesView ||
    !navDashboard ||
    !navSettings
  )
    return;
  dashboardView.style.display = view === 'dashboard' ? '' : 'none';
  movementView.style.display = view === 'movement' ? '' : 'none';
  settingsView.style.display = view === 'settings' ? 'block' : 'none';
  salesView.style.display = view === 'sales' ? '' : 'none';
  suppliersView.style.display = view === 'suppliers' ? '' : 'none';
  categoriesView.style.display = view === 'categories' ? '' : 'none';
  if (auditLogsView)
    auditLogsView.style.display = view === 'auditLogs' ? '' : 'none';
  if (usersView) usersView.style.display = view === 'users' ? '' : 'none';
  navDashboard.classList.toggle('active', view === 'dashboard');
  navSettings.classList.toggle('active', view === 'settings');
  navSuppliers?.classList.toggle('active', view === 'suppliers');
  navAuditLogs?.classList.toggle('active', view === 'auditLogs');
  navUsers?.classList.toggle('active', view === 'users');
  salesNavGroup?.classList.toggle('active', view === 'sales');
  inventoryNavGroup?.classList.toggle(
    'active',
    view === 'movement' || view === 'categories',
  );

  if (view === 'settings') {
    // Populate username + role
    const session = getSession();
    const settingUser = $<HTMLElement>('#settingUser');
    const settingRole = $<HTMLElement>('#settingRole');
    if (settingUser && session?.username)
      settingUser.textContent = session.username;
    if (settingRole && session?.role) settingRole.textContent = session.role;

    // Populate password (masked by default)
    // Password is never readable (Supabase stores it hashed). Always show dots.
    const passDisplay = $<HTMLElement>('#settingPassDisplay');
    if (passDisplay) passDisplay.textContent = '••••••••';

    // Hide the reveal (eye) button, since there is nothing to reveal.
    const revealBtn = $<HTMLButtonElement>('#togglePassReveal');
    if (revealBtn) revealBtn.style.display = 'none';
  } else {
    // Re-mask password when leaving settings
    const passDisplay = $<HTMLElement>('#settingPassDisplay');
    if (passDisplay) passDisplay.textContent = '••••••••';
    if (view === 'dashboard') resize(); // Refresh the 3D canvas when returning to the dashboard.
  }
  // Sync URL hash
  if (view === 'settings') {
    if (window.location.hash !== '#settings')
      window.location.hash = '#settings';
  } else if (view === 'sales') {
    const hash = salesMode === 'returns' ? '#sales-returns' : '#sales-pos';
    if (window.location.hash !== hash) window.location.hash = hash;
  } else if (view === 'users') {
    if (window.location.hash !== '#users') window.location.hash = '#users';
  } else if (view === 'categories') {
    if (window.location.hash !== '#categories')
      window.location.hash = '#categories';
  } else if (view === 'movement') {
    if (window.location.hash !== '#movement')
      window.location.hash = '#movement';
  } else if (view === 'suppliers') {
    if (window.location.hash !== '#suppliers')
      window.location.hash = '#suppliers';
  } else if (view === 'auditLogs') {
    renderAuditLogs();
    if (window.location.hash !== '#audit-logs')
      window.location.hash = '#audit-logs';
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

document
  .querySelectorAll<HTMLAnchorElement>('[data-sales-destination]')
  .forEach((link) =>
    link.addEventListener('click', (event) => {
      event.preventDefault();
      showSalesView(link.dataset.salesDestination as 'pos' | 'returns');
      switchView('sales');
      link.closest('.nav-submenu')?.classList.remove('open');
      const group = link.closest('.nav-group');
      group?.classList.remove('open');
      group
        ?.querySelector<HTMLButtonElement>('.nav-item.has-submenu')
        ?.setAttribute('aria-expanded', 'false');
    }),
  );

document
  .querySelectorAll<HTMLAnchorElement>('[data-inventory-destination]')
  .forEach((link) =>
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const destination = link.dataset.inventoryDestination;
      switchView(destination === 'categories' ? 'categories' : 'movement');
      if (destination === 'products') $<HTMLInputElement>('#sku')?.focus();
      const group = link.closest('.nav-group');
      group?.classList.remove('open');
      group?.querySelector('.nav-submenu')?.classList.remove('open');
      group
        ?.querySelector<HTMLButtonElement>('.nav-item.has-submenu')
        ?.setAttribute('aria-expanded', 'false');
    }),
  );

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
  } else if (window.location.hash === '#categories') {
    switchView('categories');
  } else if (window.location.hash === '#movement') {
    switchView('movement');
  } else if (window.location.hash === '#suppliers') {
    switchView('suppliers');
  } else if (window.location.hash === '#audit-logs') {
    switchView('auditLogs');
  } else if (
    window.location.hash === '#sales-pos' ||
    window.location.hash === '#sales-returns'
  ) {
    showSalesView(
      window.location.hash === '#sales-returns' ? 'returns' : 'pos',
    );
    switchView('sales');
  } else {
    switchView('dashboard');
  }
}
window.addEventListener('hashchange', checkInitialHash);
checkInitialHash();

function getSession(): { username: string; role: string } | null {
  try {
    return JSON.parse(localStorage.getItem('wh-session') ?? 'null');
  } catch {
    return null;
  }
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
  $<HTMLFormElement>('#usernameForm')?.reset();
  setModalMsg('unMsg', '');
  openModal('usernameModal');
  setTimeout(() => $<HTMLInputElement>('#unCurrentPass')?.focus(), 100);
});
$('#closeUsernameModal')?.addEventListener('click', () =>
  closeModal('usernameModal'),
);
$('#cancelUsernameModal')?.addEventListener('click', () =>
  closeModal('usernameModal'),
);

$('#openChangePassword')?.addEventListener('click', () => {
  $<HTMLFormElement>('#passwordForm')?.reset();
  setModalMsg('pwMsg', '');
  openModal('passwordModal');
  setTimeout(() => $<HTMLInputElement>('#pwCurrentPass')?.focus(), 100);
});
$('#closePasswordModal')?.addEventListener('click', () =>
  closeModal('passwordModal'),
);
$('#cancelPasswordModal')?.addEventListener('click', () =>
  closeModal('passwordModal'),
);

// Close on backdrop click
['usernameModal', 'passwordModal'].forEach((id) => {
  $<HTMLDivElement>(`#${id}`)?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === id) closeModal(id);
  });
});

/* ── Change Username ── */
$<HTMLFormElement>('#usernameForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const session = getSession();
  if (!session) return;

  const enteredPass = $<HTMLInputElement>('#unCurrentPass').value;
  const newName = $<HTMLInputElement>('#unNewName').value.trim();

  if (!enteredPass) {
    return setModalMsg('unMsg', 'Enter your current password.');
  }
  if (newName.length < 3) {
    return setModalMsg('unMsg', 'Username must be at least 3 characters.');
  }
  if (newName.toLowerCase() === session.username.toLowerCase()) {
    return setModalMsg('unMsg', 'That is already your username.');
  }
  if (
    users.some((user) => user.username.toLowerCase() === newName.toLowerCase())
  ) {
    return setModalMsg('unMsg', 'That username is already in use.');
  }

  const submitButton = $<HTMLFormElement>(
    '#usernameForm',
  ).querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;

  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    const user = userData.user;

    if (userError || !user?.email) {
      return setModalMsg(
        'unMsg',
        'Could not read your account. Please log in again.',
      );
    }

    // Check the current password by signing in with it.
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: enteredPass,
    });

    if (verifyError) {
      return setModalMsg('unMsg', 'Incorrect current password.');
    }

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ username: newName })
      .eq('id', user.id);

    if (updateError) {
      console.error('Failed to change username:', updateError);
      return setModalMsg(
        'unMsg',
        `Failed to change username: ${updateError.message}`,
      );
    }

    const oldName = session.username;
    localStorage.setItem(
      'wh-session',
      JSON.stringify({ ...session, username: newName }),
    );
    recordAudit(
      'Settings',
      'Username changed',
      `Username changed from ${oldName} to ${newName}.`,
      newName,
    );
    save();

    await loadUsersFromSupabase();

    const settingUser = $<HTMLElement>('#settingUser');
    if (settingUser) settingUser.textContent = newName;

    setModalMsg('unMsg', 'Username updated successfully!', true);
    setTimeout(() => closeModal('usernameModal'), 1200);
  } catch (error) {
    console.error('Unexpected username change error:', error);
    setModalMsg('unMsg', 'Something went wrong while changing the username.');
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
});

/* ── Change Password ── */
$<HTMLFormElement>('#passwordForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const currentPass = $<HTMLInputElement>('#pwCurrentPass').value;
  const newPass = $<HTMLInputElement>('#pwNewPass').value;
  const confirmPass = $<HTMLInputElement>('#pwConfirmPass').value;

  if (!currentPass) {
    return setModalMsg('pwMsg', 'Enter your current password.');
  }
  if (newPass.length < 8) {
    return setModalMsg('pwMsg', 'New password must be at least 8 characters.');
  }
  if (newPass !== confirmPass) {
    return setModalMsg('pwMsg', 'Passwords do not match.');
  }
  if (newPass === currentPass) {
    return setModalMsg(
      'pwMsg',
      'New password must be different from the current one.',
    );
  }

  const submitButton = $<HTMLFormElement>(
    '#passwordForm',
  ).querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;

  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    const email = userData.user?.email;

    if (userError || !email) {
      return setModalMsg(
        'pwMsg',
        'Could not read your account. Please log in again.',
      );
    }

    // Check the current password by signing in with it.
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email,
      password: currentPass,
    });

    if (verifyError) {
      return setModalMsg('pwMsg', 'Incorrect current password.');
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPass,
    });

    if (updateError) {
      console.error('Failed to change password:', updateError);
      return setModalMsg(
        'pwMsg',
        `Failed to change password: ${updateError.message}`,
      );
    }

    recordAudit(
      'Settings',
      'Password changed',
      'Account password was changed.',
    );
    save();

    setModalMsg('pwMsg', 'Password changed successfully!', true);
    setTimeout(() => closeModal('passwordModal'), 1200);
  } catch (error) {
    console.error('Unexpected password change error:', error);
    setModalMsg('pwMsg', 'Something went wrong while changing the password.');
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
});

async function initializeDashboard(): Promise<void> {
  renderUI();
  resize();

  const results = await Promise.allSettled([
    loadProductsFromSupabase(),
    loadInventoryHistoryFromSupabase(),
    loadSalesFromSupabase(),
    loadReturnsFromSupabase(),
    loadSuppliersFromSupabase(),
    loadCategoriesFromSupabase(),
    loadUsersFromSupabase(),
    loadAuditLogsFromSupabase(),
  ]);

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('Dashboard data could not be loaded:', result.reason);
    }
  }

  const loader = $('#loadingOverlay');
  loader?.classList.add('hidden');
  if (loader) setTimeout(() => loader.remove(), 600);
}

void initializeDashboard().catch((error: unknown) => {
  console.error('Dashboard initialization failed:', error);
  const message = document.querySelector('#loadingOverlay .loading-text');
  if (message)
    message.textContent =
      'Unable to load the dashboard. Please refresh to try again.';
});
