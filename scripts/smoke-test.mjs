/**
 * Smoke test for the Client half without a running DSH.
 *
 * Loads `client.js` into two VM sandboxes with a stubbed Cordis context, a fake
 * Web Notification implementation, and a mutable `document`/Session status:
 * one sandbox with the quiet rule (`__DSH_MACOS_NOTIFY_ALWAYS__ = false`) and
 * one with the always-notify demo switch. It checks the decisions the plugin
 * makes: when to notify, what it says, what clicking does, and how
 * notifications retire.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'client.js'), 'utf8');

/**
 * Build one isolated plugin instance.
 *
 * @param {{ always: boolean }} options - demo-switch value for this sandbox.
 * @returns the harness surface used by the assertions.
 */
function makeHarness({ always }) {
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
    __DSH_MACOS_NOTIFY_ALWAYS__: always,
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

  vm.runInNewContext(source, sandbox, { filename: 'client.js' });
  assert.equal(typeof moduleExports.apply, 'function');
  assert.deepEqual([...moduleExports.inject], ['uiSession', 'sessions', 'locale']);
  moduleExports.apply(ctx);
  assert.equal(listeners.size, 1);

  const emit = () => {
    for (const listener of [...listeners]) listener();
  };

  return { FakeNotification, state, effects, listeners, emit };
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

// --- Quiet rule: only background windows or other Sessions -----------------
{
  const h = makeHarness({ always: false });
  const { FakeNotification, state, effects } = h;

  // 1. Nothing pending: no notification.
  h.emit();
  assert.equal(FakeNotification.instances.length, 0, 'no pending request must stay silent');

  // 2. Pending approval on the Session the user is looking at: in-app panel is enough.
  state.currentSession = 's1';
  state.titles = { s1: '重构侧边栏', s2: '检查依赖' };
  state.pending = new Map([['s1', approval('approval:1', 'Bash', 'write outside workspace')]]);
  h.emit();
  assert.equal(FakeNotification.instances.length, 0, 'focused current Session must not notify');

  // 3. The same wait on a background Session: notify with copy, tag, and session name.
  state.pending = new Map([
    ['s1', approval('approval:1', 'Bash', 'write outside workspace')],
    ['s2', approval('approval:2', 'Bash', 'install a package')],
  ]);
  h.emit();
  assert.equal(FakeNotification.instances.length, 1, 'background approval must notify');
  const first = FakeNotification.instances[0];
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
  h.emit();
  assert.equal(first.closed, true, 'resolved request retires its notification');

  // 6. Window in the background: notify even for the current Session.
  state.pending = new Map([['s1', approval('approval:3', 'Bash', 'delete a file')]]);
  state.focused = false;
  h.emit();
  assert.equal(FakeNotification.instances.length, 2, 'background window must notify current Session');
  assert.match(FakeNotification.instances[1].body, /Bash：delete a file/);

  // 7. A resolved approval closes its notification.
  state.pending = new Map();
  h.emit();
  assert.equal(FakeNotification.instances[1].closed, true, 'resolved approval must close its notification');

  // 8. No permission, no notification.
  FakeNotification.permission = 'denied';
  state.pending = new Map([['s1', approval('approval:4', 'Bash', 'delete a file')]]);
  h.emit();
  assert.equal(FakeNotification.instances.length, 2, 'denied permission must stay silent');
  FakeNotification.permission = 'granted';

  // 9. Disposal withdraws the subscription and closes anything left open.
  state.pending = new Map([['s1', approval('approval:5', 'Bash', 'network access')]]);
  h.emit();
  assert.equal(FakeNotification.instances.length, 3);
  const open = FakeNotification.instances[2];
  const dispose = effects.at(-1);
  assert.equal(typeof dispose, 'function');
  dispose();
  assert.equal(h.listeners.size, 0, 'disposal must unsubscribe');
  assert.equal(open.closed, true, 'disposal must close live notifications');
}

// --- Demo switch: every pending approval notifies --------------------------
{
  const h = makeHarness({ always: true });
  const { FakeNotification, state } = h;

  state.currentSession = 's1';
  state.titles = { s1: '重构侧边栏' };
  state.pending = new Map([['s1', approval('approval:9', 'Bash', 'write outside workspace')]]);
  h.emit();
  assert.equal(FakeNotification.instances.length, 1, 'always mode must notify a focused current Session');

  const notification = FakeNotification.instances[0];
  notification.click();
  assert.equal(state.focusCalls, 1, 'always mode keeps the focus request');
  assert.deepEqual(state.opened, [], 'already-current Session must not be reopened');
}

console.log('dsh-macos-notify smoke test: ok');
