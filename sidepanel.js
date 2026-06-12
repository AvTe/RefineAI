// --- GLOBAL ERROR HANDLER ---
window.onerror = (msg, source, line, col, error) => {
  console.error('[RefineAI] Uncaught error:', msg, source, line);
  if (window.supabase && window.authService?.getCurrentUserId?.()) {
    window.supabase.from('error_logs').insert({
      message: String(msg).slice(0, 500),
      source: String(source).slice(0, 200),
      line_number: line,
      user_id: window.authService.getCurrentUserId(),
      created_at: new Date().toISOString()
    }).then(() => { }).catch(() => { });
  }
};

window.addEventListener('unhandledrejection', (event) => {
  console.error('[RefineAI] Unhandled promise rejection:', event.reason);
});

document.addEventListener('DOMContentLoaded', () => {
  // Helper to query active tab across windows and fall back properly (resolving DevTools/sidebar focus issues)
  const getActiveTab = async () => {
    try {
      if (typeof chrome === 'undefined' || !chrome.tabs?.query) return null;
      // Try current window first
      let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url) return tab;
      // Fallback: try last focused window (needed if DevTools/sidepanel has focus)
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tabs && tabs.length > 0 && tabs[0].url) return tabs[0];
      // Fallback: try any active tab across windows
      const anyActiveTabs = await chrome.tabs.query({ active: true });
      if (anyActiveTabs && anyActiveTabs.length > 0) {
        const supportedTab = anyActiveTabs.find(t => t.url && (
          t.url.includes('whatsapp.com') ||
          t.url.includes('linkedin.com') ||
          t.url.includes('mail.google.com') ||
          t.url.includes('chat.google.com') ||
          t.url.includes('slack.com')
        ));
        if (supportedTab) return supportedTab;
        if (anyActiveTabs[0].url) return anyActiveTabs[0];
      }
      return tab || null;
    } catch (e) {
      console.warn('[RefineAI] getActiveTab failed:', e);
      return null;
    }
  };

  // --- UI ELEMENTS ---
  const appContainer = document.querySelector('.app-container');
  const toastContainer = document.getElementById('toast-container');
  const loadingOverlay = document.getElementById('loading-overlay');

  // Views
  const views = {
    main: document.getElementById('main-view'),
    settings: document.getElementById('settings-view'),
    history: document.getElementById('history-view'),
    email: document.getElementById('email-view'),
    smart: document.getElementById('smart-view'),
    upgrade: document.getElementById('upgrade-view')
  };
  const subHeader = document.getElementById('sub-header');
  const subHeaderTitle = document.getElementById('sub-header-title');
  const backBtn = document.getElementById('back-btn');
  const historyBtn = document.getElementById('history-btn');
  const settingsBtn = document.getElementById('settings-btn');
  const goHome = document.getElementById('go-home');

  // Main View Elements
  const inputText = document.getElementById('input-text');
  const outputText = document.getElementById('output-text');
  const outputSectionUi = document.getElementById('output-section-ui');
  const wordCountDisplay = document.getElementById('word-count');
  const usageCount = document.getElementById('usage-count');
  const usageLimitTotal = document.getElementById('usage-limit-total');
  const circleProgress = document.getElementById('circle-progress');
  const usagePercentText = document.getElementById('usage-percent-text');
  const footerUpgradeBtn = document.getElementById('footer-upgrade-btn');
  const copyBtn = document.getElementById('copy-btn');
  const toolBtnSelector = '.writing-slider .tool-btn, .dropdown-item[data-action]';
  const mainReplyBtn = document.getElementById('main-reply-btn');
  const mainEmailBtn = document.getElementById('main-email-btn');
  const toneDrawer = document.getElementById('tone-drawer');
  const closeToneDrawer = document.getElementById('close-tone-drawer');
  const suggestToneBtn = document.getElementById('suggest-tone-btn');

  // Settings View Elements
  const darkModeToggle = document.getElementById('dark-mode-toggle');

  // History View Elements
  const historyList = document.getElementById('history-list');
  const clearHistoryBtn = document.getElementById('clear-history');

  // Smart Reply View Elements
  const chatHistory = document.getElementById('chat-history');
  const smartSuggestions = document.getElementById('smart-suggestions');
  const getSuggestionsBtn = document.getElementById('get-suggestions-btn');
  const smartOutputSection = document.getElementById('smart-output-section');
  const smartReplyText = document.getElementById('smart-reply-text');
  const autoReplyToggle = document.getElementById('auto-reply-toggle');
  const refreshContextBtn = document.getElementById('refresh-context');

  // --- CONFIG & STATE ---
  // Use shared config (defined in config.js)
  const CFG = window.REFINE_CONFIG;
  const WRITING_ENGINE = {
    SYSTEM_RULES: CFG.SYSTEM_RULES,
    INTENTS: CFG.INTENTS,
    TONE_HINTS: CFG.TONE_HINTS
  };

  // AI Configs moved to Supabase Edge Functions for security
  let currentConfigIndex = 0;

  // Placeholder for totalWordsProcessed (now handled by authService)
  let totalWordsProcessed = 0;

  // --- UNDO/REDO STACK ---
  const undoStack = [];
  const redoStack = [];
  const MAX_UNDO = 10;

  function pushUndoState(text) {
    if (text === undefined || text === null) return;
    undoStack.push(text);
    redoStack.length = 0;
    if (undoStack.length > MAX_UNDO) undoStack.shift();
  }

  // --- WORD-LEVEL DIFF ENGINE (no external libs) ---
  let lastInputForDiff = '';

  function computeWordDiff(oldText, newText) {
    const oldWords = oldText.trim().split(/\s+/);
    const newWords = newText.trim().split(/\s+/);
    const m = oldWords.length, n = newWords.length;

    // Build LCS table
    const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = oldWords[i - 1] === newWords[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }

    // Backtrack to build diff
    const result = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
        result.unshift({ type: 'equal', word: oldWords[i - 1] });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        result.unshift({ type: 'added', word: newWords[j - 1] });
        j--;
      } else {
        result.unshift({ type: 'removed', word: oldWords[i - 1] });
        i--;
      }
    }
    return result;
  }

  function renderDiff(diffArr) {
    return diffArr.map(d => {
      if (d.type === 'added') return `<span class="diff-added">${escapeHTML(d.word)}</span>`;
      if (d.type === 'removed') return `<span class="diff-removed">${escapeHTML(d.word)}</span>`;
      return escapeHTML(d.word);
    }).join(' ');
  }

  function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(outputText.value);
    outputText.value = undoStack.pop();
    autoResize(outputText);
    showToast('Undo', 'info', 1500);
  }

  function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(outputText.value);
    outputText.value = redoStack.pop();
    autoResize(outputText);
    showToast('Redo', 'info', 1500);
  }
  // Helper to format large numbers (e.g. 20000 -> 20k)
  const formatNumber = (num) => {
    if (num >= 1000) {
      return (num / 1000).toFixed(0) + 'k';
    }
    return num.toLocaleString();
  };

  window.syncUsageUI = (used, limit) => {
    const percent = Math.min((used / limit) * 100, 100);
    const roundedPercent = Math.round(percent);

    // Update circular progress
    if (circleProgress) {
      circleProgress.style.strokeDasharray = `${percent}, 100`;

      // Change color based on usage
      if (percent >= 90) {
        circleProgress.style.stroke = '#EF4444'; // Red
      } else if (percent >= 70) {
        circleProgress.style.stroke = '#F59E0B'; // Amber
      } else {
        circleProgress.style.stroke = 'var(--primary)';
      }
    }

    if (usagePercentText) {
      usagePercentText.textContent = `${roundedPercent}%`;
    }

    if (usageCount) {
      usageCount.textContent = used.toLocaleString();
    }

    if (usageLimitTotal) {
      usageLimitTotal.textContent = formatNumber(limit);
    }

    // Update settings account section
    const creditsUsed = document.getElementById('credits-used');
    if (creditsUsed) {
      creditsUsed.textContent = `${used.toLocaleString()} / ${limit.toLocaleString()}`;
    }

    const totalCredits = document.getElementById('total-credits');
    if (totalCredits) {
      totalCredits.textContent = limit.toLocaleString();
    }

    // Update credit progress bar in settings
    const creditProgress = document.getElementById('credit-progress');
    if (creditProgress) {
      creditProgress.style.width = `${percent}%`;
      creditProgress.classList.remove('warning', 'danger');
      if (percent >= 90) {
        creditProgress.classList.add('danger');
      } else if (percent >= 70) {
        creditProgress.classList.add('warning');
      }
    }

    const creditPercent = document.getElementById('credit-percent');
    if (creditPercent) {
      creditPercent.textContent = `${roundedPercent}% used`;
    }

    // Toggle premium UI if they are paid
    const isPaid = window.authService?.getUserProfile?.()?.plan_type !== 'free';
    if (isPaid) {
      document.body.classList.add('is-premium');
    } else {
      document.body.classList.remove('is-premium');
    }
  };

  // Footer upgrade button click
  if (footerUpgradeBtn) {
    footerUpgradeBtn.addEventListener('click', () => {
      window.switchView('upgrade');
    });
  }

  // Settings upgrade button click
  const upgradeBtn = document.getElementById('upgrade-btn');
  if (upgradeBtn) {
    upgradeBtn.addEventListener('click', () => {
      window.switchView('upgrade');
    });
  }

  // Helper for delays
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // --- ICON SYSTEM ---
  const ICON_PATHS = {
    sparkles: '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    "pencil-line": '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/><path d="m15 5 3 3"/>',
    "refresh-cw": '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>',
    "shield-check": '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/>',
    smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/>',
    "more-horizontal": '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    "minimize-2": '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" x2="21" y1="10" y2="3"/><line x1="3" x2="10" y1="21" y2="14"/>',
    "maximize-2": '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    "chevron-left": '<path d="m15 18-6-6 6-6"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    github: '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>',
    linkedin: '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect width="4" height="12" x="2" y="9"/><circle cx="4" cy="4" r="2"/>',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    "external-link": '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/>',
    "message-square": '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.454 5.709 1.455h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>',
    "messages-square": '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.454 5.709 1.455h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>',
    "rotate-cw": '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
    send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    "calendar-check": '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/>',
    "user-plus": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="16" x2="22" y1="11" y2="11"/>',
    coffee: '<path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" x2="6" y1="2" y2="4"/><line x1="10" x2="10" y1="2" y2="4"/><line x1="14" x2="14" y1="2" y2="4"/>',
    "bar-chart-3": '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
    briefcase: '<rect width="20" height="14" x="2" y="6" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    "loader-2": '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
    x: '<path d="M18 6L6 18"/><path d="m6 6 12 12"/>'
  };

  function injectIcons() {
    // If lucide is available as a library, use it directly (cleanest)
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
      return;
    }

    // Fallback manual injection for efficiency
    const iconContainers = document.querySelectorAll('[data-lucide]');
    iconContainers.forEach(container => {
      const iconName = container.getAttribute('data-lucide');
      if (ICON_PATHS[iconName]) {
        if (container.tagName.toLowerCase() === 'i' || !container.querySelector('svg')) {
          const svgHtml = `<svg class="lucide lucide-${iconName}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[iconName]}</svg>`;

          if (container.tagName.toLowerCase() === 'i') {
            const temp = document.createElement('div');
            temp.innerHTML = svgHtml;
            container.parentNode.replaceChild(temp.firstChild, container);
          } else {
            container.innerHTML = svgHtml;
          }
        }
      }
    });
  }

  // Inject immediately
  injectIcons();

  // --- AUTO RESIZE TEXTAREA ---
  function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = (textarea.scrollHeight + 2) + 'px';
  }

  inputText.addEventListener('input', () => autoResize(inputText));
  outputText.addEventListener('input', () => autoResize(outputText));
  smartReplyText.addEventListener('input', () => autoResize(smartReplyText));

  // --- KEYBOARD SHORTCUTS ---
  document.addEventListener('keydown', (e) => {
    // Ctrl+Enter → Submit/Refine current text
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      const refineBtn = document.querySelector('.rewrite-btn');
      if (refineBtn) refineBtn.click();
    }
    // Ctrl+Shift+C → Copy output to clipboard
    if (e.ctrlKey && e.shiftKey && e.key === 'C') {
      e.preventDefault();
      const output = outputText.value;
      if (output) {
        navigator.clipboard.writeText(output);
        showToast('Copied to clipboard!', 'success');
      }
    }
    // Ctrl+Shift+I → Insert output into active page element
    if (e.ctrlKey && e.shiftKey && e.key === 'I') {
      e.preventDefault();
      const insertBtn = document.getElementById('insert-btn');
      if (insertBtn) insertBtn.click();
    }
    // Escape → Go back / close drawers
    if (e.key === 'Escape') {
      const toneDrawer = document.getElementById('tone-drawer');
      if (toneDrawer && toneDrawer.classList.contains('active')) {
        toneDrawer.classList.remove('active');
        return;
      }
      const backBtn = document.getElementById('back-to-chats-btn');
      const activeChatView = document.getElementById('smart-active-chat-view');
      if (activeChatView && activeChatView.style.display !== 'none') {
        backBtn?.click();
        return;
      }
      // If in a sub-view, go back to main
      const mainBtn = document.querySelector('[data-view="main"]');
      if (mainBtn) mainBtn.click();
    }
    // Ctrl+Z → Undo refinement (only when output has focus or content)
    if (e.ctrlKey && !e.shiftKey && e.key === 'z' && document.activeElement === outputText) {
      e.preventDefault();
      undo();
    }
    // Ctrl+Y → Redo refinement
    if (e.ctrlKey && e.key === 'y' && document.activeElement === outputText) {
      e.preventDefault();
      redo();
    }
  });

  // --- TOAST SYSTEM ---
  window.showToast = function (message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  };

  // --- THEME SYSTEM ---
  const applyTheme = (theme) => {
    if (theme === 'dark') {
      document.body.classList.add('dark-theme');
      document.body.classList.remove('light-theme');
      if (darkModeToggle) darkModeToggle.checked = true;
    } else {
      document.body.classList.remove('dark-theme');
      document.body.classList.add('light-theme');
      if (darkModeToggle) darkModeToggle.checked = false;
    }
  };

  const loadTheme = () => {
    const savedTheme = localStorage.getItem('theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)');

    // If there's a saved preference, use it. Otherwise, follow system.
    if (savedTheme) {
      applyTheme(savedTheme);
    } else {
      applyTheme(systemPrefersDark.matches ? 'dark' : 'light');
    }

    // Listen for system theme changes
    systemPrefersDark.addEventListener('change', (e) => {
      // Only auto-update if the user hasn't manually set a preference
      if (!localStorage.getItem('theme')) {
        applyTheme(e.matches ? 'dark' : 'light');
      }
    });
  };

  darkModeToggle.addEventListener('change', () => {
    const newTheme = darkModeToggle.checked ? 'dark' : 'light';
    applyTheme(newTheme);
    localStorage.setItem('theme', newTheme);
  });

  loadTheme();

  // --- VIEW MANAGEMENT ---
  window.switchView = (viewName) => {
    Object.keys(views).forEach(v => views[v].classList.remove('active'));
    views[viewName].classList.add('active');

    if (viewName === 'main') {
      subHeader.style.display = 'none';
    } else {
      subHeader.style.display = 'flex';
      // Custom titles for views
      const viewTitles = {
        settings: 'Settings',
        history: 'History',
        email: 'Email Writer',
        smart: 'Smart Reply',
        upgrade: 'Upgrade Plan'
      };
      subHeaderTitle.textContent = viewTitles[viewName] || viewName.charAt(0).toUpperCase() + viewName.slice(1);
    }

    if (viewName === 'history') loadHistory();
    if (viewName === 'smart') {
      renderChatList();
      refreshActiveChat(true);
    }
    if (viewName === 'upgrade' && window.authService && window.authService.updateUpgradeView) {
      window.authService.updateUpgradeView();
    }

  };

  settingsBtn.addEventListener('click', () => switchView('settings'));
  historyBtn.addEventListener('click', () => switchView('history'));

  if (mainReplyBtn) {
    mainReplyBtn.addEventListener('click', () => switchView('smart'));
  }
  if (mainEmailBtn) {
    mainEmailBtn.addEventListener('click', () => switchView('email'));
  }

  backBtn.addEventListener('click', () => switchView('main'));
  goHome.addEventListener('click', () => switchView('main'));


  // Upgrade button in settings navigates to upgrade view

  // --- EMAIL GENERATOR ELEMENTS ---
  const generateEmailBtn = document.getElementById('generate-email-btn');
  const emailOutputSection = document.getElementById('email-output-section');
  const emailOutputText = document.getElementById('email-output-text');
  const copyEmailBtn = document.getElementById('copy-email-btn');

  // Mode Switcher
  const modeTabs = document.querySelectorAll('.mode-tab');
  const purposeGroup = document.getElementById('purpose-group');
  const contextLabel = document.getElementById('context-label');
  let currentEmailMode = 'fresh';

  modeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      modeTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentEmailMode = tab.getAttribute('data-mode');

      if (currentEmailMode === 'improve') {
        purposeGroup.style.display = 'none';
        contextLabel.textContent = 'Paste your draft email here';
        document.getElementById('email-details').placeholder = "Paste the email you've already started writing...";
      } else {
        purposeGroup.style.display = 'block';
        contextLabel.textContent = 'Key Details / Context';
        document.getElementById('email-details').placeholder = "Add specific points you want the AI to include...";
      }
    });
  });

  // Presets
  document.querySelectorAll('.preset-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.getElementById('email-purpose').value = chip.getAttribute('data-purpose');
      document.getElementById('email-details').value = chip.getAttribute('data-context');
      autoResize(document.getElementById('email-details'));
      showToast(`Preset loaded: ${chip.querySelector('span').textContent}`, 'info');
    });
  });

  // Magic Fill (Mocking for now, would typically use content script to find names)
  document.getElementById('magic-fill-sender')?.addEventListener('click', () => {
    const user = window.authService?.getUserProfile?.();
    if (user && user.full_name) {
      document.getElementById('sender-name').value = user.full_name;
      showToast('Name filled from profile', 'success');
    } else {
      showToast('Profile name not found', 'error');
    }
  });

  document.getElementById('magic-fill-recipient')?.addEventListener('click', async () => {
    // Attempt to scrape from page context via message passing
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        const tab = await getActiveTab();
        if (tab && tab.url && (tab.url.includes('linkedin.com') || tab.url.includes('mail.google.com'))) {
          chrome.tabs.sendMessage(tab.id, { action: 'SCRAPE_RECIPIENT' }, (response) => {
            if (chrome.runtime.lastError) {
              showToast('Please refresh the page first!', 'error');
              return;
            }
            if (response && response.name) {
              document.getElementById('recipient-name').value = response.name;
              showToast(`Found: ${response.name}`, 'success');
            } else {
              showToast('No name found on page', 'error');
            }
          });
        } else {
          showToast('Magic fill works on LinkedIn/Gmail', 'info');
        }
      }
    } catch (e) {
      showToast('Could not reach page', 'error');
    }
  });

  // Tone/Length Selector
  const setupChipSelectors = (selectorId) => {
    const container = document.getElementById(selectorId);
    if (!container) return;
    container.addEventListener('click', (e) => {
      const chip = e.target.closest('.select-chip');
      if (!chip) return;
      container.querySelectorAll('.select-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
  };
  setupChipSelectors('email-tone-selector');
  setupChipSelectors('email-length-selector');

  generateEmailBtn.addEventListener('click', async () => {
    const sender = document.getElementById('sender-name').value.trim();
    const recipient = document.getElementById('recipient-name').value.trim();
    const purpose = document.getElementById('email-purpose').value.trim();
    const details = document.getElementById('email-details').value.trim();
    const tone = document.querySelector('#email-tone-selector .active')?.getAttribute('data-value') || 'professional';
    const length = document.querySelector('#email-length-selector .active')?.getAttribute('data-value') || 'medium';

    if (currentEmailMode === 'fresh' && !purpose) {
      showToast('Please specify the purpose of the email.', 'error');
      return;
    }
    if (currentEmailMode === 'improve' && !details) {
      showToast('Please paste your draft first.', 'error');
      return;
    }

    const wordCount = countWords(purpose + " " + details);
    const canProceed = window.authService ? window.authService.checkLimit(wordCount) : Promise.resolve(true);

    const allowed = await canProceed;
    if (!allowed) {
      showToast('Daily word limit reached! Upgrade to continue.', 'error');
      return;
    }

    loadingOverlay.style.display = 'flex';

    const toneMap = {
      professional: "highly professional, formal, and polished",
      friendly: "warm, friendly, and approachable",
      urgent: "urgent, direct, and time-sensitive"
    };
    const lengthMap = {
      short: "very concise (under 2-3 sentences)",
      medium: "balanced and professionally thorough",
      long: "comprehensive, detailed, and elaborate"
    };

    const toneDesc = toneMap[tone] || "professional";
    const lengthDesc = lengthMap[length] || "medium length";

    const persona = window.getUserPersona ? window.getUserPersona() : "";
    const sanitizedPersona = persona.substring(0, CFG.PERSONA_MAX_LENGTH).replace(CFG.SANITIZE_REGEX, "");

    const intent = currentEmailMode === 'improve'
      ? `Improve and polish the provided email draft. Adjust tone to ${toneDesc} and length to ${lengthDesc}. Maintain core message but make it more elegant. Use Sender: "${sender || 'Me'}" and Recipient: "${recipient || 'Recipient'}".`
      : `Create a high-impact email. Sender: ${sender || 'Me'}, Recipient: ${recipient || 'Recipient'}, Purpose: ${purpose}, Context: ${details}, Tone: ${toneDesc}, Length: ${lengthDesc}.`;

    const emailTargetLanguage = window.getTargetLanguage ? window.getTargetLanguage() : "";

    const fullPrompt = `
[ SYSTEM RULES ]
${WRITING_ENGINE.SYSTEM_RULES}
- Return EXACTLY a "Subject:" line followed by the email body.
${emailTargetLanguage ? `- Write the email in ${emailTargetLanguage}.` : ""}

[ USER PERSONA ]
${sanitizedPersona || "A professional communicator."}

[ FEATURE INTENT ]
${intent}

[ QUALITY CHECK ]
Before responding:
- Check if the email sounds like a real human wrote it
- Ensure it matches the user persona and selected tone/length
If not, refine it before final output.`;

    try {
      const messages = [{ role: "user", content: fullPrompt }];
      const data = await callAICached(messages);

      if (data.choices && data.choices[0]) {
        const result = data.choices[0].message.content.trim();
        emailOutputSection.style.display = 'flex';
        emailOutputText.value = result;
        autoResize(emailOutputText);
        injectIcons();
        emailOutputSection.scrollIntoView({ behavior: 'smooth', block: 'end' });
        showToast('Email Crafted!', 'success');
        saveToHistory('email', `Mode: ${currentEmailMode} | Recipient: ${recipient}`, result);

        if (window.authService) {
          const resultWords = countWords(result);
          await window.authService.incrementWordCount(wordCount + resultWords);
        }
      }
    } catch (error) {
      showToast(`Error: ${error.message}`, 'error');
    } finally {
      loadingOverlay.style.display = 'none';
    }
  });

  copyEmailBtn.addEventListener('click', () => {
    if (!emailOutputText.value) return;
    navigator.clipboard.writeText(emailOutputText.value).then(() => {
      showToast('Email copied!', 'success');
    });
  });

  // Word counting logic
  const countWords = (str) => {
    return str.trim() === '' ? 0 : str.trim().split(/\s+/).length;
  };

  inputText.addEventListener('input', () => {
    const count = countWords(inputText.value);
    wordCountDisplay.textContent = `${count} word${count !== 1 ? 's' : ''}`;
  });

  // --- HISTORY SYSTEM (User-Specific) ---

  // Get user-specific history key
  const getHistoryKey = () => {
    const userId = window.authService?.getCurrentUserId?.();
    if (userId) {
      return `refine_history_${userId}`;
    }
    return 'refine_history_guest'; // Fallback for non-logged-in users
  };

  const saveToHistory = (action, original, refined) => {
    const historyKey = getHistoryKey();
    let history = JSON.parse(localStorage.getItem(historyKey) || '[]');
    const entry = {
      id: Date.now(),
      action: action,
      original: original,
      refined: refined,
      timestamp: new Date().toLocaleString()
    };
    history.unshift(entry); // Add to start
    history = history.slice(0, 50); // Keep last 50
    localStorage.setItem(historyKey, JSON.stringify(history));
  };

  const loadHistory = () => {
    const historyKey = getHistoryKey();
    const history = JSON.parse(localStorage.getItem(historyKey) || '[]');
    historyList.innerHTML = '';

    if (history.length === 0) {
      historyList.innerHTML = `
                <div class="empty-state">
                    <i data-lucide="clock"></i>
                    <p>No history yet. Start refining!</p>
                </div>
            `;
      injectIcons();
      return;
    }

    const escapeHTML = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    history.forEach(item => {
      const card = document.createElement('div');
      card.className = 'history-card';
      card.innerHTML = `
                <div class="history-meta">
                    <span class="history-tag">${escapeHTML(item.action)}</span>
                    <span class="history-time">${escapeHTML(item.timestamp)}</span>
                </div>
                <div class="history-preview">${escapeHTML(item.refined)}</div>
            `;
      card.addEventListener('click', () => {
        inputText.value = item.original;
        outputText.value = item.refined;
        autoResize(inputText);
        autoResize(outputText);
        outputSectionUi.style.display = 'flex';
        switchView('main');
        showToast('Restored from history!', 'success');
      });
      historyList.appendChild(card);
    });
  };

  clearHistoryBtn.addEventListener('click', () => {
    if (confirm('Clear all your writing history?')) {
      const historyKey = getHistoryKey();
      localStorage.setItem(historyKey, '[]');
      loadHistory();
      showToast('History cleared.', 'info');
    }
  });

  // --- CORE AI PROCESSING ---
  let isProcessing = false;

  async function callAI(messages) {
    if (isProcessing) {
      throw new Error('A request is already in progress. Please wait.');
    }
    isProcessing = true;
    try {
      const { data, error } = await window.supabase.functions.invoke('process-ai', {
        body: { messages }
      });

      if (error) throw error;
      return data;
    } catch (error) {
      console.error(`[RefineAI] AI processing failed:`, error);
      throw new Error("AI is currently unavailable. Please check your connection and try again.");
    } finally {
      isProcessing = false;
    }
  }

  // --- RESPONSE CACHE (in-memory, LRU, 1 hour TTL) ---
  const responseCache = new Map();

  async function callAICached(messages) {
    const cacheKey = messages.map(m => m.content.slice(0, 200)).join('|');
    const cached = responseCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts < CFG.CACHE_TTL_MS)) {
      return cached.data;
    }

    const data = await callAI(messages);

    // Store in cache (LRU eviction)
    if (responseCache.size >= CFG.CACHE_MAX_ENTRIES) {
      const oldest = responseCache.keys().next().value;
      responseCache.delete(oldest);
    }
    responseCache.set(cacheKey, { data, ts: Date.now() });

    return data;
  }
  // Use event delegation or re-select to handle the dynamically structured tools
  document.addEventListener('click', (e) => {
    const btn = e.target.closest(toolBtnSelector);
    if (!btn) return;

    // Remove active from all writing tools
    document.querySelectorAll('.writing-slider .tool-btn').forEach(b => b.classList.remove('active'));

    // If it's a tool-btn directly, add active
    if (btn.classList.contains('tool-btn')) {
      btn.classList.add('active');
    }

    const action = btn.getAttribute('data-action');
    if (!action) return;

    // Special handling for Tone
    if (action === 'tone') {
      toneDrawer.classList.toggle('active');
      injectIcons(); // Re-inject close icon
      return;
    }

    const text = inputText.value;
    if (!text.trim()) {
      showToast('Please enter some text first!', 'error');
      return;
    }

    const wordCount = countWords(text);
    const canProceed = window.authService ? window.authService.checkLimit(wordCount) : Promise.resolve(true);

    canProceed.then(allowed => {
      if (!allowed) {
        showToast('Daily word limit reached! Upgrade to Pro for more.', 'error');
        return;
      }
      processText(text, action);
    });
  });

  // Handle Tone Card Clicks
  document.querySelectorAll('.tone-card').forEach(card => {
    card.addEventListener('click', async () => {
      const tone = card.getAttribute('data-tone');
      const text = inputText.value;

      if (!text.trim()) {
        showToast('Please enter some text first!', 'error');
        return;
      }

      // Check word limit before processing
      const toneWordCount = countWords(text);
      if (window.authService) {
        const allowed = await window.authService.checkLimit(toneWordCount);
        if (!allowed) {
          showToast('Daily word limit reached! Upgrade to continue.', 'error');
          return;
        }
      }

      toneDrawer.classList.remove('active');
      processText(text, 'tone', tone);
    });
  });

  if (suggestToneBtn) {
    suggestToneBtn.addEventListener('click', async () => {
      const text = inputText.value.trim();
      if (!text) {
        showToast('Enter some text first!', 'error');
        return;
      }

      suggestToneBtn.disabled = true;
      suggestToneBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i><span>Analyzing...</span>';
      injectIcons();

      try {
        const tone = await analyzeTone(text);
        // Remove previous suggestions
        document.querySelectorAll('.tone-card').forEach(c => c.classList.remove('suggested'));

        // Find and highlight results
        const matchingCard = document.querySelector(`.tone-card[data-tone="${tone}"]`);
        if (matchingCard) {
          matchingCard.classList.add('suggested');
          matchingCard.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
          showToast(`Suggested tone: ${tone}`, 'success');
        }
      } catch (err) {
        showToast('Could not analyze tone', 'error');
      } finally {
        suggestToneBtn.disabled = false;
        suggestToneBtn.innerHTML = '<i data-lucide="sparkles"></i><span>Suggest for me</span>';
        injectIcons();
      }
    });
  }

  async function analyzeTone(text) {
    const tonesList = ["Formal", "Informal", "Professional", "Persuasive", "Neutral", "Friendly", "Confident", "Empathetic", "Informative", "Instructional", "Creative", "Technical", "Authoritative", "Motivational"];

    const persona = window.getUserPersona ? window.getUserPersona() : "";

    const systemPrompt = `You are an expert editor. Analyze the user text and persona to suggest the perfect rewriting tone.
Available tones: ${tonesList.join(", ")}

User Persona: ${persona || "Neutral"}

Output format:
TONE: <tone_name>
TYPE: <email/message/intro/general>
REASON: <1-sentence reasonWhy>`;

    const messages = [{
      role: "system",
      content: systemPrompt
    }, {
      role: "user",
      content: `Text: "${text.substring(0, 500)}..."`
    }];

    try {
      const data = await callAICached(messages);
      if (data.choices && data.choices[0]) {
        const result = data.choices[0].message.content.trim();
        const suggestedTone = tonesList.find(t => result.toUpperCase().includes(t.toUpperCase())) || "Professional";
        return suggestedTone;
      }
    } catch (e) {
      console.error(e);
    }
    return "Professional";
  }

  if (closeToneDrawer) {
    closeToneDrawer.addEventListener('click', () => {
      toneDrawer.classList.remove('active');
    });
  }

  async function processText(text, action, specificTone = null) {
    if (!text.trim()) return;

    const wordCount = countWords(text);
    const persona = window.getUserPersona ? window.getUserPersona() : "";
    const sanitizedPersona = persona.substring(0, CFG.PERSONA_MAX_LENGTH).replace(CFG.SANITIZE_REGEX, "");

    loadingOverlay.style.display = 'flex';

    const intent = (action === 'tone' && specificTone)
      ? WRITING_ENGINE.INTENTS.tone(specificTone)
      : (WRITING_ENGINE.INTENTS[action] || WRITING_ENGINE.INTENTS.rewrite);

    const toneHint = specificTone ? (WRITING_ENGINE.TONE_HINTS[specificTone] || "") : "";
    const targetLanguage = window.getTargetLanguage ? window.getTargetLanguage() : "";

    const fullPrompt = `
[ SYSTEM RULES ]
${WRITING_ENGINE.SYSTEM_RULES}
${targetLanguage ? `- Output the final text in ${targetLanguage}.` : ""}

[ USER PERSONA ]
${sanitizedPersona || "A helpful professional writer."}

[ FEATURE INTENT ]
${intent}

${toneHint ? `[ TONE MODE ]\n${toneHint}` : ""}

[ USER TEXT ]
"${text}"

[ QUALITY CHECK ]
Before responding:
- Check if the text sounds like a real human wrote it
- Ensure it matches the user persona and intent
If not, refine it before final output.`;

    try {
      const messages = [{ role: "user", content: fullPrompt }];
      const data = await callAI(messages);

      if (data.choices && data.choices[0]) {
        let result = data.choices[0].message.content.trim();
        result = result.replace(/^["']|["']$/g, '');

        // Update UI
        outputSectionUi.style.display = 'flex';
        pushUndoState(outputText.value);
        outputText.value = result;
        autoResize(outputText);

        injectIcons();
        outputSectionUi.scrollIntoView({ behavior: 'smooth', block: 'end' });

        if (window.authService) {
          const resultWords = countWords(result);
          await window.authService.incrementWordCount(wordCount + resultWords);
        }
        saveToHistory(action, text, result);
        showToast('Refined successfully!', 'success');
      }
    } catch (error) {
      console.error('AI Error:', error);
      showToast(`Error: ${error.message}`, 'error');
    } finally {
      loadingOverlay.style.display = 'none';
    }
  }


  copyBtn.addEventListener('click', () => {
    if (!outputText.value) return;
    let textToCopy = outputText.value;
    // Add watermark for free plan users
    const planType = window.authService?.getUserProfile?.()?.plan_type || 'free';
    if (planType === 'free') {
      textToCopy += '\n\n— Refined with RefineAI ✨';
    }
    navigator.clipboard.writeText(textToCopy).then(() => {
      showToast('Copied to clipboard!', 'success');
    });
  });

  // --- SMART REPLY IMPLEMENTATION ---
  let smartChats = JSON.parse(localStorage.getItem('smartChats') || '{}');
  let currentChatId = null;

  const saveSmartChats = () => {
    localStorage.setItem('smartChats', JSON.stringify(smartChats));
    renderChatList();
  };

  const renderChatList = () => {
    const listContainer = document.getElementById('smart-chat-list');
    const chatKeys = Object.keys(smartChats);

    if (chatKeys.length === 0) {
      listContainer.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor" style="opacity: 0.6; margin-bottom: 12px; display: block; margin-left: auto; margin-right: auto;">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.454 5.709 1.455h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                    <p>No saved conversations. Click "New Chat" while on a messaging site.</p>
                </div>
            `;
      injectIcons();
      return;
    }

    // Sort by timestamp
    const sortedKeys = chatKeys.sort((a, b) => smartChats[b].timestamp - smartChats[a].timestamp);

    // Helper: relative time
    const relativeTime = (ts) => {
      const diff = Date.now() - ts;
      if (diff < 60000) return 'just now';
      if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
      return `${Math.floor(diff / 86400000)}d ago`;
    };
    const escapeChat = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Filter out empty "Unknown Chat" entries
    const validKeys = sortedKeys.filter(id => {
      const chat = smartChats[id];
      if (chat.title === 'Unknown Chat' && (!chat.messages || chat.messages.length === 0)) return false;
      return true;
    });

    if (validKeys.length === 0) {
      listContainer.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor" style="opacity: 0.6; margin-bottom: 12px; display: block; margin-left: auto; margin-right: auto;">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.454 5.709 1.455h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                    <p>No saved conversations. Click "New Chat" while on a messaging site.</p>
                </div>
            `;
      injectIcons();
      return;
    }

    listContainer.innerHTML = validKeys.map(id => {
      const chat = smartChats[id];
      const lastMsg = chat.messages[chat.messages.length - 1]?.text || "No messages";
      const timeAgo = chat.timestamp ? relativeTime(chat.timestamp) : '';
      return `
                <div class="chat-item" data-id="${id}">
                    <div class="chat-item-info">
                        <span class="chat-item-name">${escapeChat(chat.title)}</span>
                        <span class="chat-item-preview">${escapeChat(lastMsg)}</span>
                    </div>
                    ${timeAgo ? `<span class="chat-item-meta">${timeAgo}</span>` : ''}
                </div>
            `;
    }).join('');

    document.querySelectorAll('.chat-item').forEach(item => {
      item.addEventListener('click', () => {
        openChat(item.getAttribute('data-id'));
      });
    });
  };

  const openChat = (id) => {
    currentChatId = id;
    const chat = smartChats[id];
    document.getElementById('active-chat-title').textContent = chat.title;
    document.getElementById('smart-chat-list-view').style.display = 'none';
    document.getElementById('smart-active-chat-view').style.display = 'block';

    updateChatHistory(chat.messages);
  };

  const updateChatHistory = (newMessages) => {
    const chatHistoryContainer = document.getElementById('chat-history');
    chatHistoryContainer.innerHTML = newMessages.map(msg => `
      <div class="message-bubble ${msg.sender === 'Me' ? 'outgoing' : 'incoming'}">
          <div class="message-sender">${msg.sender}</div>
          <div class="message-text">${msg.text}</div>
      </div>
    `).join('');
    // Scroll to the bottom immediately
    chatHistoryContainer.scrollTop = chatHistoryContainer.scrollHeight;
  };

  const backToChats = () => {
    currentChatId = null;
    document.getElementById('smart-chat-list-view').style.display = 'block';
    document.getElementById('smart-active-chat-view').style.display = 'none';
    renderChatList();
  };

  const startNewChat = async (knownTitle = null, preScrapedMessages = null) => {
    if (preScrapedMessages) {
      const id = knownTitle || 'Chat_' + Date.now();
      smartChats[id] = {
        title: knownTitle || "Unknown Chat",
        messages: preScrapedMessages,
        timestamp: Date.now()
      };
      saveSmartChats();
      openChat(id);

      const lastMsg = preScrapedMessages[preScrapedMessages.length - 1];
      if (autoReplyToggle.checked && lastMsg && lastMsg.sender === 'Them') {
        getSmartSuggestions(preScrapedMessages, knownTitle);
      }
      return;
    }

    if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
      console.log('[RefineAI] chrome.tabs.query is unavailable (mock/web environment).');
      return;
    }

    const tab = await getActiveTab();
    if (!tab) return;

    chrome.tabs.sendMessage(tab.id, { action: "SCRAPE_MESSAGES" }, (response) => {
      if (chrome.runtime.lastError) {
        showToast('Please refresh the page to enable scraping.', 'error');
        return;
      }

      if (response && response.status === 'success') {
        const id = response.chatTitle || knownTitle || 'Chat_' + Date.now();
        smartChats[id] = {
          title: response.chatTitle || "Unknown Chat",
          messages: response.messages,
          timestamp: Date.now()
        };
        saveSmartChats();
        openChat(id);

        // Auto-reply logic: only suggest if the last message is from 'Them'
        const lastMsg = response.messages[response.messages.length - 1];
        if (autoReplyToggle.checked && lastMsg && lastMsg.sender === 'Them') {
          getSmartSuggestions(response.messages, response.chatTitle);
        }
      } else {
        showToast('Please open a chat window first.', 'error');
      }
    });
  };

  const getSmartSuggestions = async (messages, specificTitle = null, autoSend = false) => {
    const targetMessages = messages || (currentChatId ? smartChats[currentChatId].messages : []);
    const chatTitle = specificTitle || (currentChatId ? smartChats[currentChatId].title : "the other person");

    if (targetMessages.length === 0) return;

    const contextString = targetMessages.map(m => `${m.sender === 'Me' ? 'Me' : 'Them'}: ${m.text}`).join('\n');
    const wordCount = countWords(contextString);

    // Check limit before calling AI
    if (window.authService) {
      const allowed = await window.authService.checkLimit(wordCount);
      if (!allowed) {
        showToast('Word limit reached! Upgrade to continue.', 'error');
        return;
      }
    }

    loadingOverlay.style.display = 'flex';
    const persona = window.getUserPersona ? window.getUserPersona() : "";
    const sanitizedPersona = persona.substring(0, CFG.PERSONA_MAX_LENGTH).replace(CFG.SANITIZE_REGEX, "");

    // Detect platform for reply style
    let platformStyle = '';
    try {
      const tab = await getActiveTab();
      if (tab && tab.url) {
        for (const [, platform] of Object.entries(CFG.PLATFORMS)) {
          if (tab.url.includes(platform.match)) {
            platformStyle = `- Reply style for ${platform.label}: ${platform.replyStyle}`;
            break;
          }
        }
      }
    } catch (e) { /* ignore tab access errors */ }

    const intent = `CONVERSATION HISTORY:
${contextString}

TASK:
Analyze the conversation and generate 3 human-like replies for 'Me' to send to 'Them'.
Replies should be natural, contextually relevant, and vary in length (short, medium, detailed).
Return exactly 3 numbered lines, each containing one suggestion.`;

    const fullPrompt = `
[ SYSTEM RULES ]
${WRITING_ENGINE.SYSTEM_RULES}
- Match the vibe of the existing conversation (e.g., lowercase if casual, short if texting).
${platformStyle}

[ USER PERSONA ]
${sanitizedPersona || "A friendly conversationalist."}

[ FEATURE INTENT ]
${intent}

[ QUALITY CHECK ]
Before responding:
- Check if the replies sound like a real human wrote them
- Ensure they match the user persona and chat context
If not, refine them before final output.`;

    try {
      const gptMessages = [{ role: "user", content: fullPrompt }];
      const data = await callAI(gptMessages);
      if (data.choices && data.choices[0]) {
        const result = data.choices[0].message.content.trim();
        // Regex handles "1.", "1)", "1 " and strips "short:", "casual:", "detailed:" labels
        const suggestions = result.split(/\n?\d[\).]\s?/)
          .filter(s => s.trim().length > 0)
          .map(s => s.replace(/^(short|casual|detailed):\s*/i, '').trim())
          .slice(0, 3);
        renderSuggestions(suggestions);

        // AUTO-SEND LOGIC (with cancel window)
        if (autoSend && suggestions.length > 0) {
          const topSuggestion = suggestions[0].trim();
          smartReplyText.value = topSuggestion;
          autoResize(smartReplyText);

          showToast('Auto-sending in 3s... Toggle off "Auto-Reply" to cancel.', 'info', 3000);
          let autoSendPending = setTimeout(() => {
            if (autoReplyToggle.checked) {
              document.getElementById('send-smart-btn').click();
            }
          }, 3000);

          // Allow cancellation by toggling off
          const cancelHandler = () => {
            clearTimeout(autoSendPending);
            showToast('Auto-send cancelled.', 'warning');
            autoReplyToggle.removeEventListener('change', cancelHandler);
          };
          autoReplyToggle.addEventListener('change', cancelHandler);
        }

        // Increment usage after success (Total words = context + suggestions)
        if (window.authService) {
          const suggestionsWords = suggestions.reduce((acc, s) => acc + countWords(s), 0);
          await window.authService.incrementWordCount(wordCount + suggestionsWords);
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      loadingOverlay.style.display = 'none';
    }
  };

  const renderSuggestions = (suggestions) => {
    smartSuggestions.innerHTML = suggestions.map(s => `
            <div class="suggestion-card">
                ${s.trim()}
            </div>
        `).join('');

    document.querySelectorAll('.suggestion-card').forEach(card => {
      card.addEventListener('click', () => {
        const text = card.innerText.trim();
        const smartOutputSection = document.getElementById('smart-output-section');
        const smartReplyText = document.getElementById('smart-reply-text');
        smartOutputSection.style.display = 'flex';
        smartReplyText.value = text;
        autoResize(smartReplyText);
        smartOutputSection.scrollIntoView({ behavior: 'smooth', block: 'end' });
      });
    });
  };

  // --- LIVE DETECTION LISTENER ---
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "NEW_MESSAGE_DETECTED") {
        console.log('[RefineAI sidepanel.js] NEW_MESSAGE_DETECTED signal received from content script.');
        if (views.smart.classList.contains('active')) {
          console.log('[RefineAI sidepanel.js] Sidepanel is in Smart Reply view. Triggering automated refresh...');
          refreshActiveChat(true);
        } else {
          console.log('[RefineAI sidepanel.js] Sidepanel is NOT in Smart Reply view. Ignoring signal.');
        }
      }
    });
  }

  const refreshActiveChat = async (isAutomated = false) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
        console.log('[RefineAI sidepanel.js] chrome.tabs.query is unavailable (web/mock mode).');
        return;
      }
      console.log(`[RefineAI sidepanel.js] refreshActiveChat() invoked. isAutomated: ${isAutomated}`);
      const tab = await getActiveTab();
      if (!tab || !tab.url) {
        console.log('[RefineAI sidepanel.js] No active tab or tab URL found.');
        return;
      }

      const isSupported = tab.url.includes('whatsapp.com') || tab.url.includes('linkedin.com') || tab.url.includes('chat.google.com') || tab.url.includes('slack.com');
      if (!isSupported) {
        console.log(`[RefineAI sidepanel.js] Current tab URL is not supported: ${tab.url}`);
        return;
      }

      console.log('[RefineAI sidepanel.js] Sending SCRAPE_MESSAGES command to content script...');
      chrome.tabs.sendMessage(tab.id, { action: "SCRAPE_MESSAGES" }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[RefineAI sidepanel.js] Error sending message to content script:', chrome.runtime.lastError.message);
          return;
        }
        if (response && response.status === 'success') {
          let chatTitle = response.chatTitle || "Unknown Chat";
          console.log(`[RefineAI sidepanel.js] Scraping response success! Chat Title: "${chatTitle}" | Scraped messages count: ${response.messages.length}`);

          // --- 1. HANDLE "UNKNOWN CHAT" RESOLUTION ---
          if (currentChatId === "Unknown Chat" && chatTitle !== "Unknown Chat") {
            console.log('[RefineAI sidepanel.js] Resolving "Unknown Chat" to its real title:', chatTitle);
            if (smartChats[chatTitle]) {
              delete smartChats[currentChatId];
              currentChatId = chatTitle;
            } else {
              smartChats[chatTitle] = smartChats[currentChatId];
              smartChats[chatTitle].title = chatTitle;
              delete smartChats[currentChatId];
              currentChatId = chatTitle;
            }
            saveSmartChats();
            renderChatList();
            document.getElementById('active-chat-title').textContent = chatTitle;
          }

          // --- 2. HANDLE CONTEXT SWITCHING / ZERO-CLICK OPEN ---
          if (!currentChatId || (currentChatId !== chatTitle && chatTitle !== "Unknown Chat")) {
            console.log(`[RefineAI sidepanel.js] Context switch detected. currentChatId: "${currentChatId}" -> chatTitle: "${chatTitle}"`);
            if (chatTitle !== "Unknown Chat" || !isAutomated) {
              if (smartChats[chatTitle]) {
                console.log('[RefineAI sidepanel.js] Switching to existing chat history for:', chatTitle);
                currentChatId = chatTitle;
                openChat(currentChatId);
              } else {
                console.log('[RefineAI sidepanel.js] Registering and opening new chat for:', chatTitle);
                startNewChat(chatTitle, response.messages);
              }
            }
            return;
          }

          if (!smartChats[currentChatId]) return;

          // --- 3. UPDATE MESSAGES ---
          const currentMsgs = JSON.stringify(smartChats[currentChatId].messages);
          const newMsgs = JSON.stringify(response.messages);

          if (currentMsgs !== newMsgs) {
            console.log('[RefineAI sidepanel.js] Message list differences detected. Updating chat history UI...');
            smartChats[currentChatId].messages = response.messages;
            smartChats[currentChatId].timestamp = Date.now();
            saveSmartChats();

            updateChatHistory(response.messages);

            const lastMsg = response.messages[response.messages.length - 1];
            console.log(`[RefineAI sidepanel.js] Last message is from: "${lastMsg?.sender}" | Auto-Reply Toggle: ${autoReplyToggle.checked}`);
            if (autoReplyToggle.checked && lastMsg && lastMsg.sender === 'Them') {
              console.log('[RefineAI sidepanel.js] Triggering auto-reply AI suggestion generation...');
              getSmartSuggestions(response.messages, response.chatTitle, isAutomated);
            }
          } else {
            console.log('[RefineAI sidepanel.js] Message list is identical. No UI update needed.');
          }
        } else {
          console.warn('[RefineAI sidepanel.js] Scraper response was unsuccessful:', response);
        }
      });
    } catch (e) {
      console.warn('[RefineAI] refreshActiveChat failed:', e);
    }
  };

  document.getElementById('new-chat-btn').addEventListener('click', () => startNewChat());
  document.getElementById('back-to-chats-btn').addEventListener('click', backToChats);
  document.getElementById('refresh-context').addEventListener('click', () => refreshActiveChat());
  getSuggestionsBtn.addEventListener('click', () => getSmartSuggestions());

  document.getElementById('insert-smart-btn').addEventListener('click', () => {
    const smartReplyText = document.getElementById('smart-reply-text');
    if (window.insertTextIntoPage) {
      window.insertTextIntoPage(smartReplyText.value);
    }
  });

  document.getElementById('send-smart-btn').addEventListener('click', async () => {
    const smartReplyText = document.getElementById('smart-reply-text');
    if (!smartReplyText.value) return;

    // Use shared insert function
    if (window.insertTextIntoPage) {
      const inserted = await window.insertTextIntoPage(smartReplyText.value);
      if (inserted) {
        // Then attempt to send
        if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
          const tab = await getActiveTab();
          if (tab) {
            setTimeout(() => {
              chrome.tabs.sendMessage(tab.id, { action: "SEND_MESSAGE" }, (sendResp) => {
                if (sendResp && sendResp.status === "success") {
                  showToast('Replied successfully!', 'success');
                  smartOutputSection.style.display = 'none';
                  smartReplyText.value = '';
                  refreshActiveChat();
                }
              });
            }, 100);
          }
        } else {
          // In mock/web environment
          showToast('Replied successfully (mock)!', 'success');
          smartOutputSection.style.display = 'none';
          smartReplyText.value = '';
        }
      }
    }
  });

  document.getElementById('copy-smart-btn').addEventListener('click', () => {
    const smartReplyText = document.getElementById('smart-reply-text');
    if (!smartReplyText.value) return;
    navigator.clipboard.writeText(smartReplyText.value).then(() => {
      showToast('Copied to clipboard!', 'success');
    });
  });

  // Initial render
  renderChatList();

  // Smart Reply auto-sync is handled inside switchView('smart')

  // --- ONBOARDING WIZARD ---
  (async function initOnboarding() {
    try {
      const stored = await chrome.storage.local.get('onboarded');
      if (stored.onboarded) return; // Already onboarded

      const overlay = document.getElementById('onboarding-overlay');
      if (!overlay) return;

      overlay.style.display = 'flex';
      let currentStep = 1;
      const totalSteps = 4;
      const nextBtn = document.getElementById('onboard-next');

      function showStep(step) {
        overlay.querySelectorAll('.onboard-step').forEach(s => s.classList.remove('active'));
        overlay.querySelectorAll('.onboard-dot').forEach(d => d.classList.remove('active'));
        const stepEl = overlay.querySelector(`.onboard-step[data-step="${step}"]`);
        const dotEl = overlay.querySelector(`.onboard-dot[data-dot="${step}"]`);
        if (stepEl) stepEl.classList.add('active');
        if (dotEl) dotEl.classList.add('active');
        nextBtn.textContent = step === totalSteps ? "Let's Go! 🚀" : 'Next →';
      }

      nextBtn.addEventListener('click', async () => {
        if (currentStep < totalSteps) {
          currentStep++;
          showStep(currentStep);
        } else {
          // Done — hide and save
          overlay.style.display = 'none';
          await chrome.storage.local.set({ onboarded: true });
        }
      });

      // Allow clicking dots to jump
      overlay.querySelectorAll('.onboard-dot').forEach(dot => {
        dot.addEventListener('click', () => {
          currentStep = parseInt(dot.getAttribute('data-dot'));
          showStep(currentStep);
        });
      });
    } catch (e) {
      // Silently fail — onboarding is non-critical
    }
  })();
});
