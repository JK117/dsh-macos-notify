/**
 * Smoke test for the Client half without a running DSH.
 *
 * Loads `client.js` into a VM sandbox with a stubbed Cordis context, a fake
 * Web Notification implementation, and a mutable `document`/Session status,
 * then checks the decisions the plugin makes: when to notify, what it says,
 * what clicking does, and how notifications retire.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'client.js'), 'utf8');

class FakeNotification {
  static permission = 'granted';
  static requests = 0;
  static instances = [];

  static requestPermission() {
    FakeNotification.requests += 1;
    return Promise.resolve(FakeNotification.permission);
  }

  constructor(title, options = {}) {
    this.title = title;
    this.body = options.body;
    this.tag = options.tag;
    this.closed = false;
    this.onclick = null;
    FakeNotification.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  click() {
    if (typeof this.onclick === 'function') this.onclick();
  }
}

/** The latest notification, for assertions. */
function latest() {
  return FakeNotification.instances.at(-1);
}

const state = {
  focused: true,
  visibility: 'visible',
  currentSession: undefined,
  titles: {},
  opened: [],
  focusCalls: 0,
  pending: new Map(),
};

let registered;
let moduleExports;
const effects = [];
const listeners = new Set();

const sandbox = {
  console,
  document: {
    get visibilityState() {
      return state.visibility;
    },
    hasFocus: () => state.focused,
  },
  window: {
    focus: () => {
      state.focusCalls += 1;
    },
    __ModuleLoader__: {
      load({ id, factory }) {
        assert.equal(id, 'dsh-macos-notify');
        moduleExports = factory(() => ({}));
      },
    },
  },
};

sandbox.Notification = FakeNotification;
sandbox.globalThis = sandbox;
sandbox.window.document = sandbox.document;

const ctx = {
  effect(run) {
    const cleanup = run();
    effects.push(cleanup);
    return () => {};
  },
  inject(deps, run) {
    assert.deepEqual([...deps], ['uiWorkspace']);
    run({
      uiWorkspace: {
        openSession(sessionId) {
          state.opened.push(sessionId);
        },
      },
    });
  },
  locale: {
    register(namespace, dictionaries) {
      assert.equal(namespace, 'dsh-macos-notify');
      registered = dictionaries;
    },
    bind(namespace) {
      assert.equal(namespace, 'dsh-macos-notify');
      return (key, params = {}) => {
        const template = registered.zh[key];
        assert.equal(typeof template, 'string', `missing zh copy for ${key}`);
        return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
      };
    },
    resolveText: (value) => value,
  },
  uiSession: {
    sessionStatus: {
      getSnapshot: () => state.pending,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    current: {
      getSnapshot: () => ({ key: state.currentSession }),
    },
  },
  sessions: {
    list: {
      getSnapshot: () => ({
        byId: Object.fromEntries(
          Object.entries(state.titles).map(([id, title]) => [id, { title }]),
        ),
      }),
    },
  },
};

/** Publish the current snapshot to the plugin, as the status store does. */
function emit() {
  for (const listener of [...listeners]) listener();
}

/** Build one pending approval entry. */
function approval(key, toolName, reason) {
  return {
    pendingInteraction: {
      kind: 'approval',
      key,
      toolName,
      reason,
      answerable: true,
    },
  };
}

vm.runInNewContext(source, sandbox, { filename: 'client.js' });
assert.equal(typeof moduleExports.apply, 'function');
assert.deepEqual([...moduleExports.inject], ['uiSession', 'sessions', 'locale']);
moduleExports.apply(ctx);
assert.equal(listeners.size, 1);

// 1. Nothing pending: no notification.
emit();
assert.equal(FakeNotification.instances.length, 0, 'no pending request must stay silent');

// 2. Pending approval on the Session the user is looking at: in-app panel is enough.
state.currentSession = 's1';
state.titles = { s1: '重构侧边栏', s2: '检查依赖' };
state.pending = new Map([['s1', approval('approval:1', 'Bash', 'write outside workspace')]]);
emit();
assert.equal(FakeNotification.instances.length, 0, 'focused current Session must not notify');

// 3. The same wait on a background Session: notify with copy, tag, and session name.
state.pending = new Map([
  ['s1', approval('approval:1', 'Bash', 'write outside workspace')],
  ['s2', approval('approval:2', 'Bash', 'install a package')],
]);
emit();
assert.equal(FakeNotification.instances.length, 1, 'background approval must notify');
const first = latest();
assert.equal(first.title, 'DSH 等待你的授权');
assert.match(first.body, /Bash：install a package/);
assert.match(first.body, /会话：检查依赖/);
assert.equal(first.tag, 'dsh-macos-notify:s2:approval:2');

// 4. Clicking reveals the owning Session, focuses the app, and closes.
first.click();
assert.equal(state.focusCalls, 1, 'click must request window focus');
assert.deepEqual(state.opened, ['s2'], 'click must reveal the owning Session');
assert.equal(first.closed, true, 'click must retire the notification');

// 5. Resolving the request closes its notification even without a click.
state.pending = new Map([['s1', approval('approval:1', 'Bash', 'write outside workspace')]]);
emit();
assert.equal(first.closed, true, 'resolved request retires its notification');

// 6. Window in the background: notify even for the current Session.
const second = new Map([['s1', approval('approval:3', 'Bash', 'delete a file')]]);
state.pending = second;
state.focused = false;
emit();
assert.equal(FakeNotification.instances.length, 2, 'background window must notify current Session');
assert.match(latest().body, /Bash：delete a file/);

// 7. A resolved approval closes its notification.
state.pending = new Map();
emit();
assert.equal(latest().closed, true, 'resolved approval must close its notification');

// 8. No permission, no notification.
FakeNotification.permission = 'denied';
state.pending = new Map([['s1', approval('approval:4', 'Bash', 'delete a file')]]);
emit();
assert.equal(FakeNotification.instances.length, 2, 'denied permission must stay silent');
FakeNotification.permission = 'granted';

// 9. Disposal withdraws the subscription and closes anything left open.
state.focused = false;
state.pending = new Map([['s1', approval('approval:5', 'Bash', 'network access')]]);
emit();
assert.equal(FakeNotification.instances.length, 3);
const open = latest();
const dispose = effects.at(-1);
assert.equal(typeof dispose, 'function');
dispose();
assert.equal(listeners.size, 0, 'disposal must unsubscribe');
assert.equal(open.closed, true, 'disposal must close live notifications');

console.log('dsh-macos-notify smoke test: ok');
