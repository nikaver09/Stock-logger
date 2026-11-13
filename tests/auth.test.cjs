const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the production entry points with browser and network dependencies stubbed.
function executeEntry(file, globals, dependencies) {
  const source = readFileSync(resolve(__dirname, '..', file), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  vm.runInNewContext(outputText, {
    exports: {},
    Error,
    console: { error() {} },
    require(id) {
      if (Object.hasOwn(dependencies, id)) return dependencies[id]();
      if (id.endsWith('.css')) return {};
      throw new Error(`Unexpected dependency: ${id}`);
    },
    ...globals,
  });
}

const settle = () => new Promise((done) => setImmediate(done));

function appHarness({
  session = null,
  profile = null,
  profileError = null,
} = {}) {
  const storage = new Map([['wh-session', 'stale session']]);
  const redirects = [];
  const message = { textContent: '' };
  let imported = false;
  let signedOut = false;
  let profileRequests = 0;
  let configuredRole = null;
  let releaseSession;
  const sessionResult = new Promise((done) => {
    releaseSession = () => done({ data: { session }, error: null });
  });
  const supabase = {
    auth: {
      getSession: () => sessionResult,
      async signOut() {
        signedOut = true;
        return { error: null };
      },
    },
    from() {
      profileRequests++;
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: profile, error: profileError }),
          }),
        }),
      };
    },
  };
  executeEntry(
    'src/app.ts',
    {
      localStorage: {
        setItem: (key, value) => storage.set(key, value),
        removeItem: (key) => storage.delete(key),
      },
      window: { location: { replace: (url) => redirects.push(url) } },
      document: { querySelector: () => message },
    },
    {
      './supabase': () => ({ supabase }),
      './access': () => ({
        configureAccess(role) {
          configuredRole = role;
        },
      }),
      './main': () => {
        assert.equal(configuredRole, profile.role);
        imported = true;
        return {};
      },
    },
  );
  return {
    storage,
    redirects,
    message,
    releaseSession,
    get configuredRole() {
      return configuredRole;
    },
    get imported() {
      return imported;
    },
    get signedOut() {
      return signedOut;
    },
    get profileRequests() {
      return profileRequests;
    },
  };
}

test('dashboard waits for authentication and redirects signed-out visitors', async () => {
  const app = appHarness();
  assert.equal(app.imported, false);
  assert.equal(app.profileRequests, 0);
  app.releaseSession();
  await settle();
  assert.deepEqual(app.redirects, ['/']);
  assert.equal(app.storage.has('wh-session'), false);
  assert.equal(app.imported, false);
});

test('dashboard initializes only after an active account is verified', async () => {
  const app = appHarness({
    session: { user: { id: 'user-1', email: 'cashier@example.com' } },
    profile: { username: 'cashier', role: 'employee', active: true },
  });
  assert.equal(app.imported, false);
  assert.equal(app.configuredRole, null);
  app.releaseSession();
  await settle();
  assert.equal(app.imported, true);
  assert.deepEqual(JSON.parse(app.storage.get('wh-session')), {
    username: 'cashier',
    role: 'employee',
  });
});

test('verified administrators retain admin access before dashboard initialization', async () => {
  const app = appHarness({
    session: { user: { id: 'admin-1' } },
    profile: { username: 'admin', role: 'admin', active: true },
  });
  app.releaseSession();
  await settle();
  assert.equal(app.imported, true);
  assert.equal(app.configuredRole, 'admin');
});

for (const profile of [
  { username: 'disabled', role: 'admin', active: false },
  { username: 'unknown', role: 'unknown', active: true },
  null,
]) {
  test(`dashboard rejects an invalid profile: ${JSON.stringify(profile)}`, async () => {
    const app = appHarness({ session: { user: { id: 'user-1' } }, profile });
    app.releaseSession();
    await settle();
    assert.equal(app.signedOut, true);
    assert.equal(app.imported, false);
    assert.deepEqual(app.redirects, ['/']);
  });
}

test('profile request failure keeps dashboard closed and displays a retry message', async () => {
  const app = appHarness({
    session: { user: { id: 'user-1' } },
    profileError: new Error('Offline'),
  });
  app.releaseSession();
  await settle();
  assert.equal(app.imported, false);
  assert.equal(app.signedOut, false);
  assert.match(app.message.textContent, /refresh/i);
});

function element() {
  const classes = new Set();
  return {
    value: '',
    textContent: '',
    style: {},
    disabled: false,
    events: {},
    classList: {
      add: (...values) => values.forEach((value) => classes.add(value)),
      remove: (...values) => values.forEach((value) => classes.delete(value)),
      contains: (value) => classes.has(value),
    },
    addEventListener(name, handler) {
      this.events[name] = handler;
    },
    setAttribute() {},
    focus() {},
    querySelector: () => ({ textContent: '' }),
  };
}

test('recovery-email success is visible, and reopening restores the email form', async () => {
  const elements = new Map();
  const get = (id) => {
    if (id === 'bg-canvas') return null;
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  get('resetStep2').classList.add('hidden');
  const requests = [];
  executeEntry(
    'src/login.ts',
    {
      document: {
        getElementById: get,
        querySelectorAll: () => [],
        addEventListener() {},
      },
      window: {
        addEventListener() {},
        location: { origin: 'https://example.com' },
      },
      requestAnimationFrame: (callback) => callback(),
    },
    {
      './login-background': () => ({ initLoginBackground() {} }),
      './password-toggle': () => ({ enablePasswordToggles() {} }),
      './supabase': () => ({
        supabase: {
          auth: {
            async resetPasswordForEmail(email, options) {
              requests.push({ email, ...options });
              return { error: null };
            },
          },
        },
      }),
    },
  );
  get('forgotCashier').events.click();
  assert.equal(get('resetStep1').classList.contains('hidden'), false);
  assert.equal(get('resetStep2').classList.contains('hidden'), true);
  get('resetUsername').value = 'cashier@example.com';
  await get('confirmReset').events.click();
  assert.equal(get('resetStep1').classList.contains('hidden'), true);
  assert.equal(get('resetStep2').classList.contains('hidden'), false);
  assert.equal(get('confirmReset').disabled, false);
  assert.equal(requests[0].email, 'cashier@example.com');
  assert.equal(
    requests[0].redirectTo,
    'https://example.com/reset-password.html',
  );

  get('closeResetSuccess').events.click();
  get('forgotAdmin').events.click();
  assert.equal(get('resetStep1').classList.contains('hidden'), false);
  assert.equal(get('resetStep2').classList.contains('hidden'), true);
  assert.equal(get('resetUsername').value, '');
});

function loginHarness({ hash = '', loadAuth, loadBackground } = {}) {
  const elements = new Map();
  const events = {};
  const storage = new Map();
  let authLoads = 0;
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const buttons = [get('employeeSubmit'), get('adminSubmit')];
  const location = { hash, origin: 'https://example.com', href: '' };
  executeEntry(
    'src/login.ts',
    {
      document: {
        getElementById: get,
        querySelectorAll: () => buttons,
        addEventListener() {},
      },
      window: {
        location,
        addEventListener(name, callback) {
          events[name] = callback;
        },
      },
      localStorage: { setItem: (key, value) => storage.set(key, value) },
      requestAnimationFrame: (callback) => callback(),
    },
    {
      './login-background':
        loadBackground ?? (() => ({ initLoginBackground() {} })),
      './password-toggle': () => ({ enablePasswordToggles() {} }),
      './supabase': () => {
        authLoads++;
        if (!loadAuth)
          throw new Error(
            'Missing Supabase configuration. Set up the project.',
          );
        return { supabase: loadAuth() };
      },
    },
  );
  return {
    get,
    events,
    buttons,
    location,
    storage,
    get authLoads() {
      return authLoads;
    },
    submit(id) {
      get(id).events.submit({ preventDefault() {} });
    },
  };
}

test('refresh initializes login controls without requiring Supabase or window.load', async () => {
  const login = loginHarness();
  await settle();
  assert.equal(login.authLoads, 0);
  assert.equal(login.events.load, undefined);
  assert.equal(login.get('loadingOverlay').classList.contains('hidden'), true);
  assert.equal(login.get('tabCashier').classList.contains('active'), true);
  login.get('tabAdmin').events.click();
  assert.equal(
    login.get('panelCashier').classList.contains('panel-hidden'),
    true,
  );
  assert.equal(login.get('tabAdmin').classList.contains('active'), true);
});

test('refresh restores the Admin tab from the URL', async () => {
  const login = loginHarness({ hash: '#admin' });
  await settle();
  assert.equal(login.get('tabAdmin').classList.contains('active'), true);
  assert.equal(
    login.get('panelAdmin').classList.contains('panel-hidden'),
    false,
  );
  assert.equal(
    login.get('panelCashier').classList.contains('panel-hidden'),
    true,
  );
  login.location.hash = '#cashier';
  login.events.hashchange();
  assert.equal(login.get('tabCashier').classList.contains('active'), true);
});

test('returning to a browser-cached login page releases the overlay and buttons', async () => {
  const login = loginHarness();
  await settle();
  login.get('loadingOverlay').classList.remove('hidden');
  login.buttons.forEach((button) => {
    button.disabled = true;
  });
  login.events.pageshow({ persisted: true });
  assert.equal(login.get('loadingOverlay').classList.contains('hidden'), true);
  assert.equal(
    login.buttons.every((button) => !button.disabled),
    true,
  );
});

test('missing configuration shows a form error and leaves the login controls usable', async () => {
  const login = loginHarness();
  login.get('empUsername').value = 'cashier@example.com';
  login.get('empPassword').value = 'test-password';
  login.submit('employeeForm');
  await settle();
  assert.match(login.get('empMsg').textContent, /not configured/);
  assert.equal(login.get('empMsg').classList.contains('visible'), true);
  assert.equal(
    login.buttons.every((button) => !button.disabled),
    true,
  );
  assert.equal(login.get('loadingOverlay').classList.contains('hidden'), true);
});

test('a background failure does not break login or tab switching after refresh', async () => {
  const login = loginHarness({
    loadBackground: () => {
      throw new Error('WebGL unavailable');
    },
  });
  await settle();
  login.get('tabAdmin').events.click();
  assert.equal(login.get('tabAdmin').classList.contains('active'), true);
  login.submit('adminForm');
  assert.match(login.get('adminMsg').textContent, /email and password/);
});

test('repeated form submissions create one sign-in request and recover on page return', async () => {
  let signIns = 0;
  let finishSignIn;
  const response = new Promise((done) => {
    finishSignIn = done;
  });
  const login = loginHarness({
    loadAuth: () => ({
      auth: {
        signInWithPassword() {
          signIns++;
          return response;
        },
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { username: 'cashier', role: 'employee', active: true },
              error: null,
            }),
          }),
        }),
      }),
    }),
  });
  login.get('empUsername').value = 'cashier@example.com';
  login.get('empPassword').value = 'test-password';
  login.submit('employeeForm');
  login.submit('employeeForm');
  await settle();
  assert.equal(signIns, 1);
  assert.equal(
    login.buttons.every((button) => button.disabled),
    true,
  );
  finishSignIn({ data: { user: { id: 'user-1' } }, error: null });
  await settle();
  assert.equal(login.location.href, '/app.html');
  assert.equal(login.get('loadingOverlay').classList.contains('hidden'), false);
  login.events.pageshow({ persisted: true });
  assert.equal(login.get('loadingOverlay').classList.contains('hidden'), true);
});

for (const [error, expected] of [
  [{ code: 'invalid_credentials' }, 'Invalid email or password.'],
  [
    { code: 'email_not_confirmed' },
    'Please confirm your email address before signing in.',
  ],
  [
    { code: 'over_request_rate_limit' },
    'Too many attempts. Please wait a few minutes and try again.',
  ],
  [new Error('Failed to fetch'), 'Unable to connect. Please try again.'],
]) {
  test(`sign-in reports the correct failure: ${expected}`, async () => {
    const login = loginHarness({
      loadAuth: () => ({
        auth: {
          signInWithPassword: async () => ({ data: { user: null }, error }),
        },
      }),
    });
    login.get('empUsername').value = 'cashier@example.com';
    login.get('empPassword').value = 'test-password';
    login.submit('employeeForm');
    await settle();
    assert.equal(login.get('empMsg').textContent, expected);
    assert.equal(login.location.href, '');
    assert.equal(
      login.buttons.every((button) => !button.disabled),
      true,
    );
  });
}

test('login styles are linked in the document head before scripts initialize', () => {
  const html = readFileSync(resolve(__dirname, '..', 'index.html'), 'utf8');
  assert.match(
    html.split('</head>')[0],
    /<link rel="stylesheet" href="\/src\/login\.css"/,
  );
});

for (const profile of [
  { username: 'admin', role: 'admin', active: true },
  { username: 'cashier', role: 'employee', active: false },
  null,
]) {
  test(`cashier login rejects an unauthorized profile: ${JSON.stringify(profile)}`, async () => {
    let signedOut = false;
    const login = loginHarness({
      loadAuth: () => ({
        auth: {
          signInWithPassword: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
          signOut: async () => { signedOut = true; return { error: null }; },
        },
        from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: profile, error: null }) }) }) }),
      }),
    });
    login.get('empUsername').value = 'cashier@example.com';
    login.get('empPassword').value = 'test-password';
    login.submit('employeeForm');
    await settle();
    assert.equal(signedOut, true);
    assert.equal(login.location.href, '');
    assert.equal(login.storage.has('wh-session'), false);
    assert.equal(login.buttons.every((button) => !button.disabled), true);
  });
}
