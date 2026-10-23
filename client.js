/**
 * dsh-macos-notify — Client half.
 *
 * DSH shows a blocking permission request as a panel inside the conversation.
 * When the window is in the background (or the request belongs to another
 * Session), that panel is invisible until you come back. This module mirrors
 * every pending approval into a macOS notification through the renderer's Web
 * Notification API: the desktop shell owns the notification, so it appears in
 * Notification Center as "DeepSeek Harness" instead of a helper process.
 *
 * Design notes:
 * - Nothing here touches the approval waterfall. Approvals are discovered from
 *   `ctx.uiSession.sessionStatus`, the same publication the approval panel
 *   consumes, so this plugin can never consume or reorder a decision.
 * - A notification is raised only when looking at the conversation would not
 *   already reveal the request: window in the background, or the pending
 *   Session differs from the main view.
 * - Clicking reveals the owning Session; resolving the request in any way
 *   closes its notification.
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
      title: 'DSH 等待你的授权',
      body: '{tool} 请求越权执行',
      bodyWithReason: '{tool}：{reason}',
      session: '会话：{title}',
      unknownTool: '有工具',
    };

    /** English dictionary, checked complete against the zh key set. */
    const en = {
      title: 'DSH needs your approval',
      body: '{tool} requests privileged execution',
      bodyWithReason: '{tool}: {reason}',
      session: 'Session: {title}',
      unknownTool: 'A tool',
    };

    /** Services this plugin cannot work without. */
    const inject = ['uiSession', 'sessions', 'locale'];

    /** Keep notification copy to the two short lines macOS renders well. */
    const BODY_LIMIT = 180;
    const TITLE_LIMIT = 60;

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
     * Mirror pending approvals into system notifications.
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

      /** The request's headline: localized escalation copy plus the asker. */
      function requestText(pending) {
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
          return shorten(t('bodyWithReason', { tool, reason }), BODY_LIMIT);
        }
        return shorten(t('body', { tool }), BODY_LIMIT);
      }

      /**
       * Whether the pending request is invisible where the user is looking.
       *
       * @param {string} sessionId - Session owning the request.
       * @returns {boolean} true when a notification adds information.
       */
      function shouldNotify(sessionId) {
        try {
          const visible = document.visibilityState === 'visible' && document.hasFocus();
          if (!visible) return true;
          return currentSessionId() !== sessionId;
        } catch (_error) {
          return true;
        }
      }

      /** Bring the application forward and reveal the asking Session. */
      function reveal(sessionId) {
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
      }

      /** Raise one notification for a newly observed pending approval. */
      function show(sessionId, pending) {
        if (typeof Notifier !== 'function') return;
        if (Notifier.permission !== 'granted') return;
        if (!shouldNotify(sessionId)) return;

        const lines = [requestText(pending)];
        const session = sessionTitle(sessionId);
        if (session !== '') lines.push(t('session', { title: session }));

        let notification;
        try {
          notification = new Notifier(t('title'), {
            body: lines.join('\n'),
            tag: `dsh-macos-notify:${sessionId}:${pending.key}`,
          });
        } catch (_error) {
          return;
        }
        notification.onclick = () => {
          reveal(sessionId);
          try {
            notification.close();
          } catch (_error) {
            /* already dismissed by the system */
          }
        };
        live.set(pending.key, { sessionId, notification });
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
          if (pending.kind !== 'approval') continue;
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
      }, 'dsh-macos-notify: approvals');
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
