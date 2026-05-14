/* ============================================================
   openctx — main script (R3)
   Runs after boot.js finishes. boot.js calls window.startSite().
   ============================================================ */

window.startSite = function startSite() {
  if (startSite._ran) return;
  startSite._ran = true;

  initYearStamp();
  initRevealOnScroll();
  initMotion();
  initCopyToClipboard();
  initNavScrolled();
  initLiveTui();
};

document.addEventListener('DOMContentLoaded', () => {
  // Pre-render the docked TUI immediately so it isn't blank when boot lifts.
  // Auto-pilot and event wiring still happen inside startSite() later.
  renderInitialTui();

  if (!document.body.classList.contains('boot-locked')) {
    window.startSite();
  }
});

function renderInitialTui() {
  const listEl = document.getElementById('session-list-lg');
  const convEl = document.getElementById('conversation-lg');
  const pathEl = document.getElementById('pane-path-lg');
  if (!listEl || !convEl) return;
  listEl.innerHTML = renderSessionList(0);
  convEl.innerHTML = renderConversation(SESSIONS[0], {});
  if (pathEl) pathEl.textContent = SESSIONS[0].path;
}

// ─────────────────────────────────────────────────────────────
// year stamp
// ─────────────────────────────────────────────────────────────
function initYearStamp() {
  const y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();
}

// ─────────────────────────────────────────────────────────────
// reveal: simple opacity/translate on viewport entry
// ─────────────────────────────────────────────────────────────
function initRevealOnScroll() {
  const targets = document.querySelectorAll('[data-reveal], [data-reveal-late]');
  if (!targets.length) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-in');
      io.unobserve(entry.target);
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -8% 0px' });
  targets.forEach((el) => io.observe(el));
}

// ─────────────────────────────────────────────────────────────
// data-motion dispatcher
// Adds .is-in to sections, applies stagger to data-motion-child
// ─────────────────────────────────────────────────────────────
function initMotion() {
  const sections = document.querySelectorAll('[data-motion]');
  if (!sections.length) return;

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const motion = el.dataset.motion;
      // stagger children
      const children = el.querySelectorAll('[data-motion-child]');
      const stride = motion === 'manuscript-rise' ? 80 :
                     motion === 'grid-stagger' ? 60 : 0;
      children.forEach((c, i) => {
        c.style.transitionDelay = `${i * stride}ms`;
      });
      el.classList.add('is-in');
      io.unobserve(el);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

  sections.forEach((el) => io.observe(el));
}

// ─────────────────────────────────────────────────────────────
// copy-to-clipboard for [data-copy]
// ─────────────────────────────────────────────────────────────
function initCopyToClipboard() {
  const toast = document.getElementById('copy-toast');
  let toastTimer = null;

  const showToast = (text = 'copied') => {
    if (!toast) return;
    toast.querySelector('.copy-toast__text').textContent = text;
    toast.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-show'), 1900);
  };

  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); return; } catch {}
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
  };

  document.querySelectorAll('[data-copy]').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.preventDefault();
      const text = el.dataset.copy;
      await copy(text);
      el.classList.add('is-copied');
      const label = el.querySelector('.install__label');
      let prev;
      if (label) { prev = label.textContent; label.textContent = 'Copied'; }
      showToast('copied — ' + text);
      setTimeout(() => {
        el.classList.remove('is-copied');
        if (label && prev !== undefined) label.textContent = prev;
      }, 1900);
    });
  });
}

// ─────────────────────────────────────────────────────────────
// nav scrolled state
// ─────────────────────────────────────────────────────────────
function initNavScrolled() {
  const nav = document.querySelector('.nav');
  if (!nav) return;
  let raf = null;
  const update = () => {
    if (window.scrollY > 8) nav.classList.add('is-scrolled');
    else nav.classList.remove('is-scrolled');
    raf = null;
  };
  document.addEventListener('scroll', () => {
    if (raf == null) raf = requestAnimationFrame(update);
  }, { passive: true });
  update();
}

// ─────────────────────────────────────────────────────────────
// LIVE TUI — auto-pilot demo (preserved from R2)
// ─────────────────────────────────────────────────────────────
const SESSIONS = [
  { src: 'cc', summary: 'auth-rework — JWT off the hot path',  path: '~/projects/api',     rel: '1m ago',    msgs: 355, current: 1,
    conv: [
      { role: 'user',      emoji: '👨', label: 'user',      rel: '2m ago',   clock: '14:32',
        body: 'can we move JWT validation off the hot path? the auth check is showing up in flame graphs.' },
      { role: 'assistant', emoji: '🤖', label: 'assistant', rel: '1m ago',   clock: '14:33',
        body:
          '<span class="md-h">## Plan</span>\n\n' +
          'The hottest call is <span class="md-code">jwt.verify()</span> doing RSA on every request. Three options, cheapest first:\n\n' +
          '  1. cache verified tokens by hash for the TTL window\n' +
          '  2. switch signing alg to <span class="md-code">EdDSA</span> — ~6× faster\n' +
          '  3. move verification to an edge worker\n\n' +
          "I'd start with (1) — single-file change, no key rotation." },
      { role: 'tool', emoji: '🔧', label: 'Read', rel: '1m ago', clock: '14:34',
        body: '<span class="md-fold">server/auth.ts  (142 lines)</span>' },
      { role: 'tool', emoji: '🔧', label: 'Edit', rel: '1m ago', clock: '14:34',
        body: '<span class="md-fold">server/auth.ts  (1 hunk)</span>' },
    ],
  },
  { src: 'gm', summary: 'vertex-ai-spike — long-context regressions', path: '~/projects/api', rel: '2h ago', msgs: 41, current: 1,
    conv: [
      { role: 'user',      emoji: '👨', label: 'user',      rel: '2h ago', clock: '13:41',
        body: 'compare 1M-token recall between <span class="md-code">gemini-2.5-pro</span> and <span class="md-code">gemini-2.0-flash</span> on the rag corpus.' },
      { role: 'assistant', emoji: '✦',  label: 'gemini',    rel: '2h ago', clock: '13:42',
        body:
          '<span class="md-h">## Recall @ 1M tokens</span>\n\n' +
          '  • <span class="md-code">2.5-pro</span> — 94% needle-in-haystack on the 980k-token corpus\n' +
          '  • <span class="md-code">2.0-flash</span> — 71% on the same corpus, 4.6× cheaper\n\n' +
          "I'd route the first pass through flash and escalate to pro on confidence < 0.7." },
      { role: 'tool', emoji: '🔧', label: 'run_shell_command', rel: '2h ago', clock: '13:43',
        body: '<span class="md-fold">bench/needle.ts  · 980k tokens · 41s</span>' },
    ],
  },
  { src: 'cc', summary: 'ink-renderer-bug — flicker on hold ↓', path: '~/projects/openctx', rel: '3h ago',    msgs: 124, current: 1,
    conv: [
      { role: 'user',      emoji: '👨', label: 'user',      rel: '3h ago', clock: '11:08',
        body: 'the preview pane flickers when I hold ↓. is that a re-render?' },
      { role: 'assistant', emoji: '🤖', label: 'assistant', rel: '3h ago', clock: '11:09',
        body:
          'Yes — every keystroke triggers a re-render of the whole transcript. Two fixes:\n\n' +
          '  • memoize <span class="md-code">renderMarkdown(session)</span> by session id\n' +
          '  • debounce the scroll-anchor recompute' },
      { role: 'tool', emoji: '🔧', label: 'Read', rel: '3h ago', clock: '11:10',
        body: '<span class="md-fold">src/components/preview.tsx  (89 lines)</span>' },
    ],
  },
  { src: 'cx', summary: 'sql-migrations — nullable archived_at', path: '~/projects/billing', rel: 'yesterday', msgs: 89, current: 1,
    conv: [
      { role: 'user',      emoji: '👨', label: 'user',      rel: 'yesterday', clock: '22:14',
        body: 'generate the up/down for adding nullable <span class="md-code">archived_at</span> to <span class="md-code">conversations</span>.' },
      { role: 'assistant', emoji: '🤖', label: 'codex',    rel: 'yesterday', clock: '22:15',
        body:
          '<span class="md-h">## 0042_conversations_archived_at.sql</span>\n\n' +
          '<span class="md-dim">-- up</span>\n' +
          'ALTER TABLE conversations\n  ADD COLUMN archived_at TIMESTAMPTZ NULL;\n' +
          'CREATE INDEX idx_conversations_archived\n  ON conversations(archived_at)\n  WHERE archived_at IS NOT NULL;' },
    ],
  },
  { src: 'cc', summary: 'type-narrowing — survives across awaits', path: '~/projects/openctx', rel: 'yesterday', msgs: 47, current: 1,
    conv: [
      { role: 'user',      emoji: '👨', label: 'user',      rel: 'yesterday', clock: '16:00',
        body: 'tsc says <span class="md-code">session.source</span> might be undefined after the early-return guard.' },
      { role: 'assistant', emoji: '🤖', label: 'assistant', rel: 'yesterday', clock: '16:01',
        body:
          'The narrowing widens back across the await. <span class="md-code">const { source } = session;</span> — locals survive awaits.' },
    ],
  },
  { src: 'cx', summary: 'landing-page-design — Linen, Ember & Moss', path: '~/projects/openctx', rel: '2d ago', msgs: 73, current: 1,
    conv: [
      { role: 'user',      emoji: '👨', label: 'user',      rel: '2d ago', clock: '09:45',
        body: 'design a cinematic 3D opener and tri-color light theme.' },
      { role: 'assistant', emoji: '🤖', label: 'codex',    rel: '2d ago', clock: '09:46',
        body:
          '<span class="md-h">## Direction</span>\n\n' +
          'Linen base. Signal Blue acts. Ember informs. Moss decorates. Three tinted papers, real grain, an asymmetric hero.' },
    ],
  },
  { src: 'gm', summary: 'long-context-eval — 2M-token ingest path', path: '~/projects/data', rel: '2d ago', msgs: 96, current: 1,
    conv: [
      { role: 'user',      emoji: '👨', label: 'user',      rel: '2d ago', clock: '14:08',
        body: 'why is the 2M-token ingest 4× slower than the 1M one? both stream the same way.' },
      { role: 'assistant', emoji: '✦',  label: 'gemini',    rel: '2d ago', clock: '14:09',
        body:
          'The chunker copies the full buffer on every <span class="md-code">slice()</span>. At 2M it dominates wall time.\n\n' +
          'Switch to byte-offset windowing — same chunker, zero copies.' },
    ],
  },
  { src: 'cc', summary: 'pty-runtime-split — node vs bun', path: '~/projects/openctx', rel: '2d ago', msgs: 22, current: 1,
    conv: [
      { role: 'user',      emoji: '👨', label: 'user',      rel: '2d ago', clock: '23:21',
        body: 'why are we shipping two pty libraries?' },
      { role: 'assistant', emoji: '🤖', label: 'assistant', rel: '2d ago', clock: '23:22',
        body:
          '<span class="md-code">@lydell/node-pty</span> on Node, <span class="md-code">bun-pty</span> on Bun. Picked at runtime via <span class="md-code">typeof Bun</span>.' },
    ],
  },
  { src: 'cc', summary: 'preview-scrollbar — paint thrash on hold', path: '~/projects/openctx', rel: '3d ago', msgs: 18, current: 1,
    conv: [
      { role: 'user',      emoji: '👨', label: 'user',      rel: '3d ago', clock: '17:42',
        body: 'the scroll overlay is killing FPS.' },
      { role: 'assistant', emoji: '🤖', label: 'assistant', rel: '3d ago', clock: '17:43',
        body: 'animate <span class="md-code">background-position</span>, not the element.' },
    ],
  },
  { src: 'cx', summary: 'rust-ffi-spike — diff renderer from bun', path: '~/projects/native', rel: '4d ago', msgs: 31, current: 1,
    conv: [
      { role: 'user',      emoji: '👨', label: 'user',      rel: '4d ago', clock: '21:17',
        body: 'spike calling rust from bun for the diff renderer.' },
      { role: 'assistant', emoji: '🤖', label: 'codex',    rel: '4d ago', clock: '21:18',
        body: 'throughput 240 ms → 9 ms on a 4 MB transcript.' },
    ],
  },
];

// Short-source-code → display-label map. Keeping this in one place lets the
// list row, continue-footer, and any future surface stay in sync with the
// real TUI's i18n table (source.claude_code / source.codex / source.gemini).
const SOURCE_LABEL = { cc: 'Claude', cx: 'Codex', gm: 'Gemini' };

function renderSessionList(activeIdx) {
  return SESSIONS.map((s, i) => `
    <div class="session${i === activeIdx ? ' is-active' : ''}" data-src="${s.src}" data-idx="${i}">
      <div class="session__row1"><span class="session__bar">▌</span><span class="session__summary">${s.summary}</span></div>
      <div class="session__row2"><span class="session__src">[${SOURCE_LABEL[s.src]}]</span><span class="session__rest">${s.rel} · ${s.msgs} msgs</span></div>
    </div>
  `).join('');
}

function renderConversation(session, opts = {}) {
  const { searchOpen = false, searchValue = '', searchCount = 0, searchPos = 0, continueOpen = false } = opts;
  const head = searchOpen ? `
    <div class="search-bar is-open">
      <span class="search-bar__pill">SEARCH</span>
      <span class="search-bar__input">${searchValue}<span class="search-bar__cursor">▍</span></span>
      ${searchValue ? `<span class="search-bar__count">${searchPos} / ${searchCount}</span>` : ''}
    </div>` : '';

  // When searching, walk the visible bodies and wrap each occurrence of the
  // query in <mark>. The N-th occurrence overall (across all bodies) gets
  // .is-current so it renders red.
  let globalMatchIdx = 0;
  const wrapMatches = (body) => {
    if (!searchOpen || !searchValue) return body;
    const re = new RegExp(escapeRegex(searchValue), 'gi');
    return body.replace(re, (m) => {
      globalMatchIdx++;
      const cls = (globalMatchIdx === searchPos) ? ' class="is-current"' : '';
      return `<mark${cls}>${m}</mark>`;
    });
  };

  const items = session.conv.map((m, idx) => {
    const isCurrent = idx === session.current;
    const body = wrapMatches(m.body);
    return `
      <div class="msg msg--${m.role}${isCurrent ? ' is-current' : ''}">
        <div class="msg__header">
          <span class="msg__cursor">${isCurrent ? '›' : ' '}</span>
          <span class="msg__bar">▍</span>
          <span class="msg__emoji">${m.emoji}</span>
          <span class="msg__role">${m.label}</span>
          <span class="msg__meta">·  ${m.rel}  ·  ${m.clock}</span>
        </div>
        <div class="msg__body">${body}</div>
      </div>
    `;
  }).join('');
  const tail = continueOpen ? `
    <div class="continue-footer is-open">
      <span class="continue-footer__label">↪ Continue conversation</span>
      <span class="continue-footer__src">[${SOURCE_LABEL[session.src]}]</span>
    </div>` : '';
  return head + items + tail;
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const FOOTERS = {
  list:    [['↑↓', 'select'], ['⏎', 'focus preview'], ['⇥', 'menu'], ['q', 'quit']],
  preview: [['↑↓', 'scroll'], ['esc', 'back'], ['⌃F', 'find'], ['⇥', 'expand tool'], ['⏎', 'continue'], ['q', 'quit']],
  search:  [['type', 'to search'], ['⏎', 'commit'], ['esc', 'cancel']],
};

function renderFooter(ctx) {
  const parts = FOOTERS[ctx];
  return parts.map((p, i) => `
    ${i > 0 ? '<span class="tui__footer-sep">·</span>' : ''}
    <span class="tui__footer-keys">${p[0]} ${p[1]}</span>
  `).join('');
}

function initLiveTui() {
  const listEl = document.getElementById('session-list-lg');
  const convEl = document.getElementById('conversation-lg');
  const pathEl = document.getElementById('pane-path-lg');
  const footEl = document.getElementById('tui-footer-lg');
  const keyEl  = document.getElementById('keystroke-lg');
  if (!listEl || !convEl) return;

  const listPane = listEl.closest('.pane');
  const previewPane = convEl.closest('.pane');

  const state = {
    cursor: 0, focus: 'list',
    searchOpen: false, searchValue: '', searchCount: 0, searchPos: 0,
    continueOpen: false,
  };

  const setActive = (idx) => {
    state.cursor = (idx + SESSIONS.length) % SESSIONS.length;
    state.continueOpen = false;
    state.searchOpen = false;
    state.searchValue = '';
    listEl.innerHTML = renderSessionList(state.cursor);
    listEl.querySelectorAll('.session').forEach((el) => {
      el.addEventListener('click', () => {
        stopAuto();
        flashKey('⏎');
        setActive(parseInt(el.dataset.idx, 10));
        scheduleResume();
      });
    });
    refreshPreview();
    if (pathEl) pathEl.textContent = SESSIONS[state.cursor].path;
    const active = listEl.querySelector('.session.is-active');
    if (active) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const refreshPreview = () => {
    convEl.innerHTML = renderConversation(SESSIONS[state.cursor], {
      searchOpen: state.searchOpen,
      searchValue: state.searchValue,
      searchCount: state.searchCount,
      searchPos: state.searchPos,
      continueOpen: state.continueOpen,
    });
  };

  const setFocus = (which) => {
    state.focus = which;
    if (listPane) listPane.dataset.focused = (which === 'list').toString();
    if (previewPane) previewPane.dataset.focused = (which === 'preview').toString();
    updateFooter();
  };

  const updateFooter = () => {
    if (!footEl) return;
    let ctx = state.focus;
    if (state.searchOpen) ctx = 'search';
    footEl.innerHTML = renderFooter(ctx);
  };

  let keyTimer;
  const flashKey = (k) => {
    if (!keyEl) return;
    keyEl.textContent = k;
    keyEl.classList.add('is-show');
    clearTimeout(keyTimer);
    keyTimer = setTimeout(() => keyEl.classList.remove('is-show'), 460);
  };

  const script = [
    { wait: 1300, do: () => { flashKey('↓'); setActive(state.cursor + 1); } },
    { wait: 1300, do: () => { flashKey('↓'); setActive(state.cursor + 1); } },
    { wait: 1700, do: () => { flashKey('⏎'); setFocus('preview'); } },
    { wait: 1500, do: () => { flashKey('⏎'); state.continueOpen = true; refreshPreview(); } },
    { wait: 1700, do: () => { flashKey('esc'); state.continueOpen = false; refreshPreview(); } },
    // Land on the auth-rework session so the search demo actually highlights matches
    { wait: 1200, do: () => { flashKey('esc'); setFocus('list'); } },
    { wait: 1000, do: () => { flashKey('↑'); setActive(state.cursor - 1); } },
    { wait: 1000, do: () => { flashKey('↑'); setActive(state.cursor - 1); } },
    { wait: 1500, do: () => { flashKey('⏎'); setFocus('preview'); } },
    { wait: 1100, do: () => { flashKey('⌃F'); state.searchOpen = true; state.searchValue = ''; state.searchCount = 0; state.searchPos = 0; updateFooter(); refreshPreview(); } },
    { wait: 700,  do: () => { state.searchValue = 'au';   state.searchCount = 21; state.searchPos = 1; refreshPreview(); } },
    { wait: 700,  do: () => { state.searchValue = 'auth'; state.searchCount = 14; state.searchPos = 1; refreshPreview(); } },
    { wait: 1100, do: () => { flashKey('n'); state.searchPos = 2; refreshPreview(); } },
    { wait: 1100, do: () => { flashKey('n'); state.searchPos = 3; refreshPreview(); } },
    { wait: 1300, do: () => { flashKey('esc'); state.searchOpen = false; state.searchValue = ''; updateFooter(); refreshPreview(); } },
    { wait: 1300, do: () => { flashKey('esc'); setFocus('list'); } },
    { wait: 1200, do: () => { flashKey('↓'); setActive(state.cursor + 1); } },
    { wait: 1200, do: () => { flashKey('↓'); setActive(state.cursor + 1); } },
  ];

  let stepIdx = 0;
  let autoTimer = null;
  let idleTimer = null;

  const tick = () => {
    const s = script[stepIdx % script.length];
    stepIdx++;
    s.do();
    autoTimer = setTimeout(tick, s.wait);
  };
  const stopAuto = () => { clearTimeout(autoTimer); clearTimeout(idleTimer); autoTimer = null; };
  const scheduleResume = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => { stepIdx = 0; tick(); }, 4500); };

  setActive(0);
  setFocus('list');

  const root = listEl.closest('.hero__product') || listEl.closest('.tui');
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        if (!autoTimer) autoTimer = setTimeout(tick, 1100);
      } else {
        stopAuto();
      }
    });
  }, { threshold: 0.15 });
  if (root) io.observe(root);
}
