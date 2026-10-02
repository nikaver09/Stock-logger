import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './style.css';

/* ---------- auth guard ---------- */
(function checkAuth() {
  try {
    const session = JSON.parse(localStorage.getItem('wh-session') ?? 'null');
    if (!session?.username) {
      window.location.replace('/');
    }
  } catch {
    window.location.replace('/');
  }
})();

type Item = { sku: string; name: string; qty: number; slot: number };
type Log = { id: number; time: string; sku: string; type: 'IN' | 'OUT'; qty: number; note: string };
type Move = 'IN' | 'OUT';

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
let items: Item[] = load('wh-items', seed);
let logs: Log[] = load('wh-logs', []);
let type: Move = 'IN';
const save = () => {
  localStorage.setItem('wh-items', JSON.stringify(items));
  localStorage.setItem('wh-logs', JSON.stringify(logs));
};

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

scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x1a1f26, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(5, 10, 6);
scene.add(sun);

const floor = new THREE.GridHelper(16, 16, 0x3a4656, 0x252d38);
scene.add(floor);

const W = 1.2, GAP = 1.5;
const rackMat = new THREE.MeshStandardMaterial({ color: 0x4a5a70, metalness: 0.6, roughness: 0.4 });
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

type Box = THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> & { cur: number; glow: number };
const boxes = new Map<string, Box>();
const boxGeo = new THREE.BoxGeometry(1, 1, 1);

function syncBoxes() {
  for (const it of items) {
    let b = boxes.get(it.sku);
    if (!b) {
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue(it.sku), 0.55, 0.55), roughness: 0.5 });
      b = Object.assign(new THREE.Mesh(boxGeo, mat), { cur: 0.01, glow: 1 }) as Box;
      b.userData.sku = it.sku;
      scene.add(b);
      boxes.set(it.sku, b);
    }
    b.userData.target = height(it.qty);
    b.material.emissive.set(it.qty < LOW ? 0xff3b1f : 0x000000);
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
}

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
