/**
 * Smoke test for the Client half without a running DSH.
 *
 * Loads `client.js` into two VM sandboxes with a stubbed Cordis context, a fake
 * Web Notification implementation, and a mutable `document`/Session status:
 * one sandbox with the quiet rule (`__DSH_MACOS_NOTIFY_ALWAYS__ = false`) and
 * one with the always-notify demo switch. It checks the decisions the plugin
 * makes: when to notify, what it says, what clicking does, and how
 * notifications retire — for approvals, questions, plan reviews, and unknown
 * pending-interaction domains.
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
    origins: {},
    opened: [],
    focusCalls: 0,
    panels: [],
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
    get(name) {
      if (name !== 'userQuestionPanels') return undefined;
      return {
        reveal(sessionId, callId) {
          state.panels.push([sessionId, callId]);
          return true;
        },
      };
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
            Object.entries(state.titles).map(([id, title]) => [
              id,
              { title, origin: state.origins[id] },
            ]),
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

  // Both dictionaries must stay key-aligned; the renderer picks one at runtime.
  assert.deepEqual(Object.keys(registered.en).sort(), Object.keys(registered.zh).sort());

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

/** Build one pending `ask_user_question` entry. */
function question(key, sessionId, prompts, extra = {}) {
  return {
    pendingInteraction: {
      kind: 'question',
      key,
      sessionId,
      callId: key.slice(key.lastIndexOf(':') + 1),
      questions: prompts.map((prompt, index) => ({ id: `q${index + 1}`, question: prompt })),
      ...extra,
    },
  };
}

/** Build one pending plan-review entry (an `ask_user_question` with plan intent). */
function planReview(key, sessionId, title) {
  return {
    pendingInteraction: {
      kind: 'plan-review',
      key,
      sessionId,
      callId: key.slice(key.lastIndexOf(':') + 1),
      questions: [{
        id: 'q1',
        question: 'Approve this plan?',
        detail: `# ${title}\n\n## Goal\n\nShip the change.`,
        intent: { kind: 'plan-review', approve: '开始实施' },
        options: [{ label: '开始实施' }, { label: '先不实施' }],
      }],
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

// --- Questions, plan reviews, and unknown domains -------------------------
{
  const h = makeHarness({ always: false });
  const { FakeNotification, state } = h;

  state.currentSession = 's1';
  state.titles = { s1: '重构侧边栏', s2: '检查依赖' };
  state.focused = true;

  // 1. A background question notifies with its prompt and a question title.
  state.pending = new Map([
    ['s2', question('question:s2:call-1', 's2', ['要保留旧的导出函数吗？'])],
  ]);
  h.emit();
  assert.equal(FakeNotification.instances.length, 1, 'background question must notify');
  const asked = FakeNotification.instances[0];
  assert.equal(asked.title, 'DSH 等待你的回答');
  assert.match(asked.body, /要保留旧的导出函数吗？/);
  assert.match(asked.body, /会话：检查依赖/);
  assert.equal(asked.tag, 'dsh-macos-notify:s2:question:s2:call-1');

  // 2. Clicking a question reveals the panel as well as the Session.
  asked.click();
  assert.deepEqual(state.panels, [['s2', 'call-1']], 'click must reopen the question panel');
  assert.deepEqual(state.opened, ['s2'], 'click must reveal the owning Session');

  // 3. A multi-question batch says how many answers are wanted.
  state.pending = new Map([
    ['s2', question('question:s2:call-2', 's2', ['先改文案还是先改逻辑？', '需要补测试吗？'])],
  ]);
  h.emit();
  assert.equal(FakeNotification.instances.length, 2);
  const batch = FakeNotification.instances[1];
  assert.match(batch.body, /先改文案还是先改逻辑？/);
  assert.match(batch.body, /共 2 个问题/);

  // 4. A plan review names the plan from its markdown heading.
  state.pending = new Map([
    ['s2', planReview('question:s2:call-3', 's2', '扩展通知覆盖全部待处理交互')],
  ]);
  h.emit();
  assert.equal(FakeNotification.instances.length, 3);
  const review = FakeNotification.instances[2];
  assert.equal(review.title, 'DSH 等待你审批计划');
  assert.match(review.body, /计划：扩展通知覆盖全部待处理交互/);
  assert.equal(review.tag, 'dsh-macos-notify:s2:question:s2:call-3');

  // 5. A read-only review card replays settled answers and must stay silent.
  state.pending = new Map([
    ['s2', {
      pendingInteraction: {
        kind: 'question',
        key: 'question:s2:call-4',
        sessionId: 's2',
        callId: 'call-4',
        questions: [{ id: 'q1', question: '已经回答过的问题' }],
        review: { answers: [] },
      },
    }],
  ]);
  h.emit();
  assert.equal(FakeNotification.instances.length, 3, 'review cards must not notify');

  // 6. An unknown future domain still notifies, with generic copy.
  state.pending = new Map([
    ['s2', {
      pendingInteraction: { kind: 'elicitation', key: 'elicitation:1', sessionId: 's2' },
    }],
  ]);
  h.emit();
  assert.equal(FakeNotification.instances.length, 4, 'unknown domains must still notify');
  assert.equal(FakeNotification.instances[3].title, 'DSH 等待你的响应');
  assert.match(FakeNotification.instances[3].body, /有操作需要你处理/);

  // 7. Answering the batch retires every notification that belonged to it.
  state.pending = new Map();
  h.emit();
  for (const notification of FakeNotification.instances) {
    assert.equal(notification.closed, true, 'resolved interactions must close their notifications');
  }
}

// --- Demo switch: every pending interaction notifies ----------------------
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

  state.pending = new Map([['s1', question('question:s1:call-9', 's1', ['继续吗？'])]]);
  h.emit();
  assert.equal(FakeNotification.instances.length, 2, 'always mode must notify a focused question');
  assert.equal(FakeNotification.instances[1].title, 'DSH 等待你的回答');
}

console.log('dsh-macos-notify smoke test: ok');

// --- Session completion: a finished turn notifies, quietly ---------------
{
  const h = makeHarness({ always: false });
  const { FakeNotification, state, effects } = h;

  state.currentSession = 's1';
  state.titles = { s1: '重构侧边栏', s2: '检查依赖' };
  state.focused = true;

  // 1. An idle Session at startup is a baseline, not a completion.
  state.pending = new Map([['s2', { running: false }]]);
  h.emit();
  assert.equal(FakeNotification.instances.length, 0, 'an idle baseline must not notify');

  // 2. Starting a turn is not a completion.
  state.pending = new Map([['s2', { running: true }]]);
  h.emit();
  assert.equal(FakeNotification.instances.length, 0, 'a running turn must not notify');

  // 3. A background Session finishing notifies once, with its name and tag.
  state.pending = new Map([['s2', { running: false }]]);
  h.emit();
  assert.equal(FakeNotification.instances.length, 1, 'a finished background turn must notify');
  const first = FakeNotification.instances[0];
  assert.equal(first.title, 'DSH 会话已完成');
  assert.match(first.body, /本轮已结束，点击查看结果/);
  assert.match(first.body, /会话：检查依赖/);
  assert.equal(first.tag, 'dsh-macos-notify:session-complete:s2');
  h.emit();
  assert.equal(FakeNotification.instances.length, 1, 'one finish must notify only once');

  // 4. Clicking reveals the finished Session, focuses, and closes.
  first.click();
  assert.equal(state.focusCalls, 1, 'click must request window focus');
  assert.deepEqual(state.opened, ['s2'], 'click must reveal the finished Session');
  assert.equal(first.closed, true, 'click must retire the finished notification');

  // 5. A new turn retires the previous finished notification.
  state.pending = new Map([['s2', { running: true }]]);
  h.emit();
  state.pending = new Map([['s2', { running: false }]]);
  h.emit();
  assert.equal(FakeNotification.instances.length, 2, 'a second turn finish notifies again');
  const second = FakeNotification.instances[1];
  state.pending = new Map([['s2', { running: true }]]);
  h.emit();
  assert.equal(second.closed, true, 'starting a new turn must retire the finished notification');

  // 6. A focused current Session needs no completion notification.
  state.pending = new Map([['s1', { running: true }]]);
  h.emit();
  state.pending = new Map([['s1', { running: false }]]);
  h.emit();
  assert.equal(FakeNotification.instances.length, 2, 'focused current Session must stay quiet');

  // 7. A background window does need one, even for the current Session.
  state.focused = false;
  state.pending = new Map([['s1', { running: true }]]);
  h.emit();
  state.pending = new Map([['s1', { running: false }]]);
  h.emit();
  assert.equal(FakeNotification.instances.length, 3, 'background window must notify completion');
  assert.match(FakeNotification.instances[2].body, /会话：重构侧边栏/);
  state.focused = true;

  // 8. A blocking interaction at the stop owns the reminder; no duplicate.
  state.pending = new Map([['s2', { running: true }]]);
  h.emit();
  const paused = planReview('question:s2:call-9', 's2', '先审批再实施');
  state.pending = new Map([['s2', {
    running: false,
    pendingInteraction: paused.pendingInteraction,
  }]]);
  h.emit();
  assert.equal(FakeNotification.instances.length, 4, 'a pause for an interaction must not notify completion');
  assert.equal(FakeNotification.instances[3].title, 'DSH 等待你审批计划');

  // 9. Subagent completions are bookkeeping, not a user-facing finish.
  state.origins = { s2: 'subagent' };
  state.pending = new Map([['s2', { running: true }]]);
  h.emit();
  state.pending = new Map([['s2', { running: false }]]);
  h.emit();
  assert.equal(FakeNotification.instances.length, 4, 'subagent completions must stay silent');
  state.origins = {};

  // 10. Disposal closes every finished notification.
  state.pending = new Map([['s2', { running: true }]]);
  h.emit();
  state.pending = new Map([['s2', { running: false }]]);
  h.emit();
  assert.equal(FakeNotification.instances.length, 5);
  const last = FakeNotification.instances[4];
  assert.equal(last.closed, false);
  const dispose = effects.at(-1);
  assert.equal(typeof dispose, 'function');
  dispose();
  assert.equal(last.closed, true, 'disposal must close live finished notifications');
  assert.equal(h.listeners.size, 0, 'disposal must unsubscribe');
}

// --- Session completion: permission denied and always mode ---------------
{
  const h = makeHarness({ always: false });
  const { FakeNotification, state } = h;

  state.currentSession = 's1';
  state.titles = { s1: '重构侧边栏' };
  state.focused = false;
  FakeNotification.permission = 'denied';
  state.pending = new Map([['s1', { running: true }]]);
  h.emit();
  state.pending = new Map([['s1', { running: false }]]);
  h.emit();
  assert.equal(FakeNotification.instances.length, 0, 'denied permission must silence completion');

  FakeNotification.permission = 'granted';
  state.pending = new Map([['s1', { running: true }]]);
  h.emit();
  state.pending = new Map([['s1', { running: false }]]);
  h.emit();
  assert.equal(FakeNotification.instances.length, 1, 'granted permission must allow completion');
}

{
  const h = makeHarness({ always: true });
  const { FakeNotification, state } = h;

  state.currentSession = 's1';
  state.titles = { s1: '重构侧边栏' };
  state.focused = true;
  state.pending = new Map([['s1', { running: true }]]);
  h.emit();
  state.pending = new Map([['s1', { running: false }]]);
  h.emit();
  assert.equal(FakeNotification.instances.length, 1, 'always mode must notify a focused completion');
  assert.equal(FakeNotification.instances[0].title, 'DSH 会话已完成');
}
