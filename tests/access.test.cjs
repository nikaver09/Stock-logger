const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function evaluate(source, globals) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const context = { exports: {}, ...globals };
  vm.runInNewContext(outputText, context);
  return context;
}

for (const role of ['admin', 'employee']) {
  test(`${role} receives the correct controls and cache access`, () => {
    const html = readFileSync('app.html', 'utf8');
    const ids = [
      'navUsers',
      'navAuditLogs',
      'usersView',
      'auditLogsView',
      'userModal',
      'auditDetailModal',
    ];
    for (const id of ids) {
      const tag = html.match(new RegExp(`<[^>]+id="${id}"[^>]*>`));
      assert.ok(tag, `Missing ${id}`);
      assert.match(tag[0], /data-admin-only/);
    }
    const removed = [];
    const cleared = [];
    let adminAttribute = false;
    const { exports: access } = evaluate(
      readFileSync('src/access.ts', 'utf8'),
      {
        document: {
          documentElement: {
            toggleAttribute(name, enabled) {
              adminAttribute = enabled;
            },
          },
          querySelectorAll: () =>
            ids.map((id) => ({ remove: () => removed.push(id) })),
        },
        localStorage: { removeItem: (key) => cleared.push(key) },
      },
    );
    assert.equal(access.isAdmin(), false);
    access.configureAccess(role);
    assert.equal(access.isAdmin(), role === 'admin');
    assert.equal(adminAttribute, role === 'admin');
    assert.deepEqual(removed, role === 'admin' ? [] : ids);
    assert.deepEqual(
      cleared,
      role === 'admin' ? [] : ['wh-users', 'wh-audit-logs'],
    );
  });
}

// Exercise production functions without starting the unrelated WebGL scene.
function dashboardFunctions(globals) {
  const source = ts.createSourceFile(
    'main.ts',
    readFileSync('src/main.ts', 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const names = new Set([
    'switchView',
    'loadUsersFromSupabase',
    'loadAuditLogsFromSupabase',
    'openUserEditor',
    'renderUsers',
    'renderAuditLogs',
  ]);
  const functions = source.statements
    .filter(
      (node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text),
    )
    .map((node) => node.getText(source))
    .join('\n');
  return evaluate(functions, globals);
}

test('cashier cannot load or render admin data or open the user editor', async () => {
  const context = dashboardFunctions({ isAdmin: () => false });
  // No database or DOM is supplied: any access would fail this test.
  await context.loadUsersFromSupabase();
  await context.loadAuditLogsFromSupabase();
  context.renderUsers();
  context.renderAuditLogs();
  context.openUserEditor();
});

for (const role of ['admin', 'employee']) {
  for (const view of ['users', 'auditLogs']) {
    test(`${role} navigation to ${view} enforces role access`, () => {
      const elements = {};
      for (const name of [
        'dashboardView',
        'movementView',
        'settingsView',
        'salesView',
        'suppliersView',
        'categoriesView',
        'navDashboard',
        'navSettings',
        'navSuppliers',
        'navAuditLogs',
        'navUsers',
        'salesNavGroup',
        'inventoryNavGroup',
      ]) {
        elements[name] = { style: {}, classList: { toggle() {} } };
      }
      elements.usersView = role === 'admin' ? { style: {} } : null;
      elements.auditLogsView = role === 'admin' ? { style: {} } : null;
      const location = {
        hash: view === 'users' ? '#users' : '#audit-logs',
        pathname: '/app.html',
        search: '',
      };
      const context = dashboardFunctions({
        ...elements,
        isAdmin: () => role === 'admin',
        window: {
          location,
          history: {
            replaceState() {
              location.hash = '';
            },
          },
        },
        $: () => null,
        resize() {},
      });
      context.renderAuditLogs = () => {};
      context.switchView(view);
      assert.equal(
        elements.dashboardView.style.display,
        role === 'admin' ? 'none' : '',
      );
      assert.equal(
        location.hash,
        role === 'admin' ? (view === 'users' ? '#users' : '#audit-logs') : '',
      );
      if (role === 'admin') {
        assert.equal(
          elements[`${view === 'users' ? 'users' : 'auditLogs'}View`].style
            .display,
          '',
        );
      }
    });
  }
}
