const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function harness(options = {}) {
  let handler;
  const calls = { created: [], profiles: [], deleted: [] };
  const client = {
    auth: {
      getUser: async () => ({
        data: { user: options.invalidToken ? null : { id: 'admin-id' } },
        error: null,
      }),
      admin: {
        createUser: async (body) => {
          calls.created.push(body);
          return options.duplicateEmail
            ? { data: {}, error: { message: 'Email already registered' } }
            : { data: { user: { id: 'new-id' } }, error: null };
        },
        deleteUser: async (id) => {
          calls.deleted.push(id);
          return { error: options.cleanupError ? {} : null };
        },
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: options.caller ?? { role: 'admin', active: true },
            error: null,
          }),
        }),
        ilike: () => ({
          limit: async () => ({
            data: options.duplicateUsername ? [{ id: 'existing' }] : [],
            error: null,
          }),
        }),
      }),
      upsert: async (body) => {
        calls.profiles.push(body);
        return { error: options.profileError ? { code: 'failure' } : null };
      },
    }),
  };
  const source = readFileSync(
    'supabase/functions/create-user/index.ts',
    'utf8',
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  vm.runInNewContext(outputText, {
    exports: {},
    Request,
    Response,
    console: { error() {} },
    require: () => ({ createClient: () => client }),
    Deno: {
      env: { get: () => 'test' },
      serve: (fn) => {
        handler = fn;
      },
    },
  });
  const body = {
    email: 'new@example.com',
    password: 'strong-test-password',
    username: 'newuser',
    firstName: 'New',
    lastName: 'User',
    role: 'employee',
    active: true,
  };
  return {
    calls,
    run: (overrides = {}, headers = { Authorization: 'Bearer test-token' }) =>
      handler(
        new Request('https://example.com/create-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ ...body, ...overrides }),
        }),
      ),
  };
}

test('create-user rejects missing and invalid authentication', async () => {
  for (const invalidToken of [false, true]) {
    const h = harness({ invalidToken });
    assert.equal((await h.run({}, invalidToken ? undefined : {})).status, 401);
    assert.equal(h.calls.created.length, 0);
  }
});

test('create-user denies employees and inactive administrators', async () => {
  for (const caller of [
    { role: 'employee', active: true },
    { role: 'admin', active: false },
  ]) {
    const h = harness({ caller });
    assert.equal((await h.run()).status, 403);
    assert.equal(h.calls.created.length, 0);
  }
});

test('create-user validates fields and rejects duplicate usernames before Auth creation', async () => {
  for (const input of [
    { role: 'owner' },
    { password: '123' },
    { active: 'true' },
    { email: 'bad' },
  ]) {
    const h = harness();
    assert.equal((await h.run(input)).status, 400);
    assert.equal(h.calls.created.length, 0);
  }
  const h = harness({ duplicateUsername: true });
  assert.equal((await h.run()).status, 409);
  assert.equal(h.calls.created.length, 0);
});

test('create-user saves Auth account and matching profile without returning password', async () => {
  const h = harness();
  const response = await h.run({ role: 'admin', active: false });
  assert.equal(response.status, 201);
  assert.equal(h.calls.created[0].email_confirm, true);
  assert.equal(h.calls.profiles[0].id, 'new-id');
  assert.equal(h.calls.profiles[0].role, 'admin');
  assert.equal(h.calls.profiles[0].active, false);
  assert.equal('password' in h.calls.profiles[0], false);
  assert.equal(
    JSON.stringify(await response.json()).includes('strong-test-password'),
    false,
  );
});

test('create-user handles duplicate email without writing a profile', async () => {
  const h = harness({ duplicateEmail: true });
  assert.equal((await h.run()).status, 400);
  assert.equal(h.calls.profiles.length, 0);
});

test('create-user rolls back Auth creation on profile failure and reports failed cleanup', async () => {
  for (const cleanupError of [false, true]) {
    const h = harness({ profileError: true, cleanupError });
    const response = await h.run();
    assert.equal(response.status, 500);
    assert.deepEqual(h.calls.deleted, ['new-id']);
    const result = await response.json();
    assert.match(result.error, cleanupError ? /repair or remove/ : /cancelled/);
  }
});
