/**
 * dsh-macos-notify — Client half.
 *
 * DSH shows every interaction that blocks the agent — a permission request, an
 * `ask_user_question` batch, or a plan submitted for review — as a panel inside
 * the conversation. When the window is in the background (or the request
 * belongs to another Session), that panel is invisible until you come back.
 * This module mirrors every pending interaction into a macOS notification
 * through the renderer's Web Notification API: the desktop shell owns the
 * notification, so it appears in Notification Center as "DeepSeek Harness"
 * instead of a helper process.
 *
 * Design notes:
 * - Nothing here touches the interaction waterfalls. Pending interactions are
 *   discovered from `ctx.uiSession.sessionStatus`, the same publication the
 *   panels themselves consume, so this plugin can never consume or reorder a
 *   decision.
 * - Notifications follow `pendingInteraction.kind`: `approval` (permission),
 *   `question` (ask_user_question), `plan-review` (a question batch whose
 *   intent marks it as a plan decision), and a generic fallback for any future
 *   domain that registers one.
 * - A notification is raised only when looking at the conversation would not
 *   already reveal the request: window in the background, or the pending
 *   Session differs from the main view.
 * - Clicking reveals the owning Session (and, for questions, the answerable
 *   panel); resolving the request in any way closes its notification.
 */
window.__ModuleLoader__.load({
  id: 'dsh-macos-notify',
  factory(require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    /** Locale namespace owned by this plugin. */
    const NS = 'dsh-macos-notify';

    /** Simplified Chinese dictionary (the key-set source of truth). */
    const zh = {
      titleApproval: 'DSH 等待你的授权',
      titleQuestion: 'DSH 等待你的回答',
      titlePlanReview: 'DSH 等待你审批计划',
      titleGeneric: 'DSH 等待你的响应',
      bodyApproval: '{tool} 请求越权执行',
      bodyApprovalWithReason: '{tool}：{reason}',
      bodyQuestion: '{question}',
      bodyQuestionBatch: '{question}（共 {count} 个问题）',
      bodyPlanReview: '计划：{title}',
      bodyGeneric: '有操作需要你处理',
      session: '会话：{title}',
      unknownTool: '有工具',
      unknownQuestion: 'DSH 有一个问题要问你',
    };

    /** English dictionary, checked complete against the zh key set. */
    const en = {
      titleApproval: 'DSH needs your approval',
      titleQuestion: 'DSH needs your answer',
      titlePlanReview: 'DSH needs your plan review',
      titleGeneric: 'DSH needs your response',
      bodyApproval: '{tool} requests privileged execution',
      bodyApprovalWithReason: '{tool}: {reason}',
      bodyQuestion: '{question}',
      bodyQuestionBatch: '{question} ({count} questions)',
      bodyPlanReview: 'Plan: {title}',
      bodyGeneric: 'Something is waiting for you',
      session: 'Session: {title}',
      unknownTool: 'A tool',
      unknownQuestion: 'DSH has a question for you',
    };

    /** Services this plugin cannot work without. */
    const inject = ['uiSession', 'sessions', 'locale'];

    /** Keep notification copy to the two short lines macOS renders well. */
    const BODY_LIMIT = 180;
    const TITLE_LIMIT = 60;

    /**
     * Debug switch: when `window.__DSH_MACOS_NOTIFY_ALWAYS__ === true` before
     * the bundle materializes, every pending interaction notifies even while
     * the window is focused on the asking Session. Off by default; the console
     * escape hatch is for observing or diagnosing delivery.
     */
    const ALWAYS_NOTIFY = globalThis.__DSH_MACOS_NOTIFY_ALWAYS__ === true;

    /**
     * Collapse whitespace and cap a piece of copy at a character budget.
     *
     * @param {unknown} text - candidate copy, possibly not a string.
     * @param {number} limit - maximum number of characters to keep.
     * @returns {string} the normalized, shortened copy.
     */
    function shorten(text, limit) {
      if (typeof text !== 'string') return '';
      const clean = text.replace(/\s+/g, ' ').trim();
      if (clean.length <= limit) return clean;
      return clean.slice(0, Math.max(0, limit - 1)) + '…';
    }

    /**
     * Name a plan from its markdown: the first heading, else the first real
     * line. Used so a plan-review notification says what is being reviewed
     * instead of only that a decision is waiting.
     *
     * @param {unknown} detail - plan markdown carried as the question detail.
     * @returns {string} the plan's name, empty when the markdown carries none.
     */
    function planName(detail) {
      if (typeof detail !== 'string') return '';
      const lines = detail.split('\n');
      for (const line of lines) {
        const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
        if (heading !== null) return shorten(heading[1].replace(/[*_`]/g, ''), TITLE_LIMIT);
      }
      for (const line of lines) {
        const text = line.trim();
        if (text === '' || /^[-*_]{3,}$/.test(text) || text.startsWith('```')) continue;
        return shorten(text.replace(/^[>\-*+\d.\s]+/, '').replace(/[*_`]/g, ''), TITLE_LIMIT);
      }
      return '';
    }

    /**
     * Mirror pending interactions into system notifications.
     *
     * @param {object} ctx - the Client root context.
     */
    function apply(ctx) {
      ctx.effect(
        () => ctx.locale.register(NS, { zh, en }),
        'dsh-macos-notify: dictionaries',
      );

      const t = ctx.locale.bind(NS);
      const status = ctx.uiSession.sessionStatus;
      const Notifier = globalThis.Notification;
      let openSession;
      /** Notification handles by pending interaction key. */
      const live = new Map();

      ctx.inject(['uiWorkspace'], (scope) => {
        openSession = (sessionId) => scope.uiWorkspace.openSession(sessionId);
      });

      if (typeof Notifier === 'function' && Notifier.permission === 'default') {
        try {
          const asking = Notifier.requestPermission();
          if (asking && typeof asking.catch === 'function') asking.catch(() => {});
        } catch (_error) {
          /* a browser without a gesture just leaves the permission pending */
        }
      }

      /** The Session currently shown in the main view, if any. */
      function currentSessionId() {
        try {
          return ctx.uiSession.current.getSnapshot()?.key;
        } catch (_error) {
          return undefined;
        }
      }

      /** The owning Session's title, when the catalog already knows it. */
      function sessionTitle(sessionId) {
        try {
          const list = ctx.sessions.list.getSnapshot();
          return shorten(list?.byId?.[sessionId]?.title, TITLE_LIMIT);
        } catch (_error) {
          return '';
        }
      }

      /** The request's question batch, normalized to an array. */
      function questionsOf(pending) {
        return Array.isArray(pending.questions) ? pending.questions : [];
      }

      /** The notification title, by interaction kind. */
      function titleFor(pending) {
        if (pending.kind === 'approval') return t('titleApproval');
        if (pending.kind === 'plan-review') return t('titlePlanReview');
        if (pending.kind === 'question') return t('titleQuestion');
        return t('titleGeneric');
      }

      /** The request's headline: localized escalation copy plus the asker. */
      function approvalText(pending) {
        const tool = pending.toolName ? pending.toolName : t('unknownTool');
        let reason;
        try {
          reason = pending.displayReason === undefined
            ? pending.reason
            : ctx.locale.resolveText(pending.displayReason);
        } catch (_error) {
          reason = pending.reason;
        }
        if (typeof reason === 'string' && reason.trim() !== '') {
          return t('bodyApprovalWithReason', { tool, reason });
        }
        return t('bodyApproval', { tool });
      }

      /** The request's headline for a question batch or a plan review. */
      function questionText(pending) {
        const questions = questionsOf(pending);
        const first = questions[0];
        if (first === undefined || first === null) return t('unknownQuestion');

        if (pending.kind === 'plan-review') {
          const plan = planName(first.detail);
          if (plan !== '') return t('bodyPlanReview', { title: plan });
          return typeof first.question === 'string' && first.question.trim() !== ''
            ? first.question
            : t('unknownQuestion');
        }

        const line = typeof first.question === 'string' && first.question.trim() !== ''
          ? first.question
          : t('unknownQuestion');
        if (questions.length > 1) {
          return t('bodyQuestionBatch', { question: line, count: questions.length });
        }
        return t('bodyQuestion', { question: line });
      }

      /** The notification body: what is being asked, in one short line. */
      function requestText(pending) {
        let text;
        if (pending.kind === 'approval') text = approvalText(pending);
        else if (pending.kind === 'question' || pending.kind === 'plan-review') text = questionText(pending);
        else text = t('bodyGeneric');
        return shorten(text, BODY_LIMIT);
      }

      /**
       * Whether the pending request is invisible where the user is looking.
       *
       * @param {string} sessionId - Session owning the request.
       * @returns {boolean} true when a notification adds information.
       */
      function shouldNotify(sessionId) {
        if (ALWAYS_NOTIFY) return true;
        try {
          const visible = document.visibilityState === 'visible' && document.hasFocus();
          if (!visible) return true;
          return currentSessionId() !== sessionId;
        } catch (_error) {
          return true;
        }
      }

      /**
       * Bring the application forward, reveal the asking Session, and reopen
       * the answerable question panel when the interaction is a question the
       * user may have dismissed.
       *
       * @param {string} sessionId - Session owning the request.
       * @param {object} pending - the pending interaction that was notified.
       */
      function reveal(sessionId, pending) {
        try {
          window.focus();
        } catch (_error) {
          /* the OS already activates the app when its notification is clicked */
        }
        if (openSession !== undefined && currentSessionId() !== sessionId) {
          try {
            openSession(sessionId);
          } catch (_error) {
            /* a removed or still-loading Session must not break the click */
          }
        }
        if (pending.kind !== 'question' && pending.kind !== 'plan-review') return;
        if (typeof pending.callId !== 'string') return;
        let panels;
        try {
          panels = typeof ctx.get === 'function' ? ctx.get('userQuestionPanels') : undefined;
        } catch (_error) {
          panels = undefined;
        }
        if (panels === undefined || panels === null) return;
        try {
          panels.reveal(sessionId, pending.callId);
        } catch (_error) {
          /* a question UI outside this client keeps the transcript instead */
        }
      }

      /** Raise one notification for a newly observed pending interaction. */
      function show(sessionId, pending) {
        if (typeof Notifier !== 'function') return;
        if (Notifier.permission !== 'granted') return;
        if (!shouldNotify(sessionId)) return;

        const lines = [requestText(pending)];
        const session = sessionTitle(sessionId);
        if (session !== '') lines.push(t('session', { title: session }));

        let notification;
        try {
          notification = new Notifier(shorten(titleFor(pending), TITLE_LIMIT), {
            body: lines.join('\n'),
            tag: `dsh-macos-notify:${sessionId}:${pending.key}`,
          });
        } catch (_error) {
          return;
        }
        notification.onclick = () => {
          reveal(sessionId, pending);
          try {
            notification.close();
          } catch (_error) {
            /* already dismissed by the system */
          }
        };
        live.set(pending.key, { sessionId, pending, notification });
      }

      /** Close and forget one notification. */
      function dismiss(key) {
        const entry = live.get(key);
        if (entry === undefined) return;
        live.delete(key);
        try {
          entry.notification.close();
        } catch (_error) {
          /* already dismissed by the system */
        }
      }

      /** Reconcile the live notifications with the pending-interaction snapshot. */
      function reconcile() {
        if (status === undefined) return;
        let snapshot;
        try {
          snapshot = status.getSnapshot();
        } catch (_error) {
          return;
        }

        const pendingKeys = new Set();
        for (const [sessionId, value] of snapshot) {
          const pending = value?.pendingInteraction;
          if (pending === undefined || pending === null) continue;
          // A read-only card replays answers for a call that already settled.
          if (pending.review !== undefined) continue;
          // Approvals publish `answerable`; a settled one is on its way out.
          if (pending.answerable === false) continue;
          const key = pending.key;
          if (typeof key !== 'string') continue;
          pendingKeys.add(key);
          if (!live.has(key)) show(sessionId, pending);
        }
        for (const key of [...live.keys()]) {
          if (!pendingKeys.has(key)) dismiss(key);
        }
      }

      ctx.effect(() => {
        const stop = status.subscribe(reconcile);
        reconcile();
        return () => {
          stop();
          for (const key of [...live.keys()]) dismiss(key);
        };
      }, 'dsh-macos-notify: pending interactions');
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
