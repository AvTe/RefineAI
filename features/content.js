// --- REAL-TIME DETECTION ---
let observer = null;
let lastUpdate = 0;

function startObserver() {
    if (observer) observer.disconnect();

    let currentChatTitle = "";

    observer = new MutationObserver((mutations) => {
        const now = Date.now();
        const url = window.location.href;

        // --- CHAT SWITCH DETECTION ---
        if (url.includes('whatsapp.com')) {
            const titleEl = document.querySelector('header ._amig, header ._3W2ap, #main header span[dir="auto"]');
            if (titleEl) {
                const newTitle = titleEl.innerText.trim();
                if (newTitle && newTitle !== currentChatTitle) {
                    currentChatTitle = newTitle;
                    console.log(`[RefineAI content.js] Chat title switched to: "${newTitle}"`);
                    chrome.runtime.sendMessage({ action: "NEW_MESSAGE_DETECTED" }); // Trigger refresh on switch
                }
            }
        }

        if (now - lastUpdate < 1500) return; // Debounce

        let detected = false;

        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                // Check if added nodes are message-like
                if (url.includes('linkedin.com')) {
                    if (document.querySelector('.msg-s-event-listitem')) detected = true;
                } else if (url.includes('whatsapp.com')) {
                    const chatMain = document.getElementById('main');
                    if (chatMain && chatMain.contains(mutation.target)) {
                        detected = true;
                    }
                } else if (url.includes('mail.google.com') || url.includes('chat.google.com')) {
                    if (document.querySelector('.adn, .nE57Xb, [role="listitem"]')) detected = true;
                } else if (url.includes('slack.com')) {
                    if (document.querySelector('.c-message')) detected = true;
                }
            }
            if (detected) break;
        }

        if (detected) {
            lastUpdate = now;
            console.log('[RefineAI content.js] New message or DOM change detected inside the chat container (#main). Notifying sidepanel...');
            chrome.runtime.sendMessage({ action: "NEW_MESSAGE_DETECTED" });
        }
    });

    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

// Start observing
startObserver();

// Refresh observer on URL change (for SPAs)
let lastUrl = location.href;
new MutationObserver(() => {
    if (location.href !== lastUrl) {
        lastUrl = location.href;
        startObserver();
    }
}).observe(document, { subtree: true, childList: true });

function findComposeBox(url) {
    if (url.includes('whatsapp.com')) {
        return document.querySelector('[data-testid="conversation-compose-box-input"]') || 
               document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
               document.querySelector('div[contenteditable="true"][data-tab="6"]') ||
               document.querySelector('#main footer div[contenteditable="true"]');
    }
    if (url.includes('linkedin.com')) {
        return document.querySelector('.msg-form__contenteditable') || 
               document.querySelector('div[contenteditable="true"][role="textbox"]');
    }
    if (url.includes('mail.google.com')) {
        return document.querySelector('.Am.Al.editable') || 
               document.querySelector('div[contenteditable="true"][aria-label="Message Body"]');
    }
    if (url.includes('slack.com')) {
        return document.querySelector('.ql-editor') || 
               document.querySelector('div[contenteditable="true"][role="textbox"]');
    }
    if (url.includes('chat.google.com')) {
        return document.querySelector('div[contenteditable="true"][role="textbox"]') || 
               document.querySelector('[data-testid="chat-input"]');
    }
    return document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea');
}

// Content Script for Inserting Text
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "INSERT_TEXT") {
        console.log(`[RefineAI content.js] INSERT_TEXT message received. Text length: ${request.text ? request.text.length : 0}`);
        const url = window.location.href;
        const activeElement = document.activeElement;
        let composeBox = null;

        if (activeElement && (activeElement.contentEditable === 'true' || activeElement.role === 'textbox' || activeElement.tagName === 'TEXTAREA' || (activeElement.tagName === 'INPUT' && activeElement.type === 'text'))) {
            composeBox = activeElement;
        } else {
            composeBox = findComposeBox(url);
        }

        if (composeBox) {
            console.log('[RefineAI content.js] Found compose box in DOM. Focusing compose box...');
            composeBox.focus();
            const isContentEditable = composeBox.contentEditable === 'true' || composeBox.role === 'textbox';

            if (isContentEditable) {
                const selection = window.getSelection();
                let range = document.createRange();
                range.selectNodeContents(composeBox);
                range.collapse(false); // place cursor at the end
                selection.removeAllRanges();
                selection.addRange(range);

                document.execCommand('insertText', false, request.text);

                // Fallback / Trigger events
                composeBox.dispatchEvent(new Event('input', { bubbles: true }));
                composeBox.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
                const start = composeBox.selectionStart || 0;
                const end = composeBox.selectionEnd || 0;
                const text = composeBox.value || '';
                composeBox.value = text.slice(0, start) + request.text + text.slice(end);
                composeBox.selectionStart = composeBox.selectionEnd = start + request.text.length;
                composeBox.dispatchEvent(new Event('input', { bubbles: true }));
                composeBox.dispatchEvent(new Event('change', { bubbles: true }));
            }
            console.log('[RefineAI content.js] Text successfully inserted into compose box.');
            sendResponse({ status: "success" });
        } else {
            console.warn('[RefineAI content.js] No focusable compose box found in DOM.');
            sendResponse({ status: "no_active_element" });
        }
    } else if (request.action === "SCRAPE_MESSAGES") {
        try {
            let messages = [];
            let chatTitle = "Unknown Chat";
            const url = window.location.href;

            if (url.includes('linkedin.com')) {
                // Improved LinkedIn Selectors
                const linkedInMessages = document.querySelectorAll('.msg-s-event-listitem__body, .msg-s-message-group__item, .msg-s-event-listitem__message-bubble');
                const titleEl = document.querySelector('.msg-entity-lockup__entity-title, .msg-overlay-bubble-header__title, .msg-thread__name, .msg-entity-lockup__title');
                if (titleEl) chatTitle = titleEl.innerText.split('\n')[0].trim();

                messages = Array.from(linkedInMessages).map(m => {
                    const isMe = m.closest('.msg-s-event-listitem--outbound') || m.closest('.msg-s-message-group--outbound');
                    return {
                        text: m.innerText.trim(),
                        sender: isMe ? 'Me' : 'Them'
                    };
                });
            } else if (url.includes('whatsapp.com')) {
                // Highly robust WhatsApp Selectors
                const waMessages = document.querySelectorAll('.message-in, .message-out, div[class*="message-in"], div[class*="message-out"], [data-testid="msg-container"]');
                const titleEl = document.querySelector('#main header span[dir="auto"], #main header ._amig, header canvas + div span');
                if (titleEl) chatTitle = titleEl.innerText.trim() || titleEl.getAttribute('title');

                console.log(`[RefineAI content.js] Scraping messages for WhatsApp chat "${chatTitle}". Found ${waMessages.length} elements in DOM.`);
                const seenIds = new Set();
                const processedMessages = [];

                for (const m of Array.from(waMessages)) {
                    const msgId = m.getAttribute('data-id') || m.closest('[data-id]')?.getAttribute('data-id');
                    if (msgId) {
                        if (seenIds.has(msgId)) continue;
                        seenIds.add(msgId);
                    }

                    // Detect sender using class name, data-id, or status/read receipt icons (100% reliable fallback)
                    const hasStatusIcon = m.querySelector('[data-icon="msg-dblcheck"]') ||
                        m.querySelector('[data-icon="msg-check"]') ||
                        m.querySelector('[data-icon="msg-dblcheck-ack"]') ||
                        m.querySelector('[data-icon="msg-time"]') ||
                        m.querySelector('[data-icon*="check"]') ||
                        m.querySelector('[data-icon*="status"]') ||
                        m.querySelector('[aria-label="Read"]') ||
                        m.querySelector('[aria-label="Delivered"]') ||
                        m.querySelector('[aria-label="Sent"]') ||
                        m.querySelector('[aria-label="Pending"]') ||
                        m.querySelector('[aria-label*="read" i]') ||
                        m.querySelector('[aria-label*="delivered" i]') ||
                        m.querySelector('[aria-label*="sent" i]') ||
                        m.querySelector('[aria-label*="pending" i]') ||
                        m.querySelector('[data-testid="status-icon"]');

                    const isMe = m.classList.contains('message-out') ||
                        m.className.includes('message-out') ||
                        msgId?.startsWith('true') ||
                        msgId?.includes('true_') ||
                        !!hasStatusIcon;

                    const textEl = m.querySelector('.selectable-text.copyable-text span') ||
                        m.querySelector('.copyable-text span') ||
                        m.querySelector('._ao3e') ||
                        m.querySelector('span.selectable-text') ||
                        m.querySelector('[class*="selectable-text"]');

                    let text = "";
                    if (textEl) {
                        text = textEl.innerText.trim();
                    } else {
                        // Extract text by removing meta/time nodes in a clone to avoid timestamp inclusion
                        const clone = m.cloneNode(true);
                        const metaEls = clone.querySelectorAll('[class*="time"], [class*="status"], ._am3a, .copyable-text + div, span[data-icon], svg');
                        metaEls.forEach(el => el.remove());
                        text = clone.innerText.trim();
                    }

                    // Strip any remaining trailing timestamps
                    text = text.replace(/\d{1,2}:\d{2}\s?(AM|PM|am|pm)?$/gi, '').trim();

                    if (text) {
                        console.log(`[RefineAI content.js] Scraped message: "${text.substring(0, 40)}..." | sender: ${isMe ? 'Me' : 'Them'} (hasStatusIcon: ${!!hasStatusIcon}, msgId: ${msgId})`);
                        processedMessages.push({ text, sender: isMe ? 'Me' : 'Them' });
                    }
                }
                messages = processedMessages;
                console.log(`[RefineAI content.js] Finished scraping. Total processed messages sent to sidepanel: ${messages.length}`);
            }
            else if (url.includes('mail.google.com')) {
                const gmailMessages = document.querySelectorAll('.adn.ads, div[role="listitem"]');
                const titleEl = document.querySelector('h2.hP');
                if (titleEl) chatTitle = titleEl.innerText.trim();
                messages = Array.from(gmailMessages).map(m => {
                    const senderName = m.querySelector('.gD')?.innerText || '';
                    const isMe = m.querySelector('.gD')?.getAttribute('email') === 'me' || senderName.toLowerCase().includes('me');
                    return {
                        text: m.innerText.trim(),
                        sender: isMe ? 'Me' : 'Them'
                    };
                });
            } else if (url.includes('slack.com')) {
                const slackMessages = document.querySelectorAll('.c-message__body');
                const titleEl = document.querySelector('.p-view_header__channel_title, .c-base_entity__name');
                if (titleEl) chatTitle = titleEl.innerText.trim();
                messages = Array.from(slackMessages).map(m => {
                    const senderBtn = m.closest('.c-message')?.querySelector('.c-message__sender_button');
                    const isMe = senderBtn?.innerText.toLowerCase().includes('me') || false; // Slack is harder without knowing user's name
                    return {
                        text: m.innerText.trim(),
                        sender: isMe ? 'Me' : 'Them'
                    };
                });
            } else if (url.includes('chat.google.com') || (url.includes('mail.google.com') && document.querySelector('.nH.V8dj9'))) {
                const gcMessages = document.querySelectorAll('.nE57Xb, .V8P9m, [role="listitem"] .cmV08d, .Zc1z6c');
                const titleEl = document.querySelector('.Hz7P8c, .uG74ab, [role="main"] header h1, .p9H55e .XG0p8b');
                if (titleEl) chatTitle = titleEl.innerText.trim();
                messages = Array.from(gcMessages).map(m => {
                    const text = m.innerText.trim();
                    const parent = m.closest('[role="listitem"], .K7p66e');
                    const senderEl = parent?.querySelector('.oM799c, .P91f7c, .Wp9f7c');
                    const senderName = senderEl ? senderEl.innerText.trim() : '';
                    const isMe = senderName.toLowerCase().includes('me') || parent?.classList.contains('me') || false;
                    return {
                        text,
                        sender: isMe ? 'Me' : 'Them'
                    };
                });
            }

            const finalMessages = messages.filter(m => m.text && m.text.length > 0).slice(-15);
            sendResponse({ status: "success", messages: finalMessages, chatTitle });
        } catch (e) {
            sendResponse({ status: "error", message: e.message });
        }
    } else if (request.action === "SCRAPE_RECIPIENT") {
        try {
            let name = "";
            const url = window.location.href;
            if (url.includes('linkedin.com')) {
                const titleEl = document.querySelector('.msg-entity-lockup__entity-title, .msg-overlay-bubble-header__title, .msg-thread__name, .msg-entity-lockup__title, .pv-top-card-section__name, [class*="text-heading-xlarge"]');
                if (titleEl) name = titleEl.innerText.split('\n')[0].trim();
            } else if (url.includes('mail.google.com')) {
                const titleEl = document.querySelector('.gD, .yP, .zF'); // Recipient name in a thread/list
                if (titleEl) name = titleEl.innerText.trim();
            }
            sendResponse({ status: "success", name: name });
        } catch (e) {
            sendResponse({ status: "error", message: e.message });
        }
    } else if (request.action === "SEND_MESSAGE") {
        console.log('[RefineAI content.js] SEND_MESSAGE request received.');
        const findAndClickSend = (attempts = 0) => {
            try {
                const url = window.location.href;
                let sendBtn = null;

                if (url.includes('linkedin.com')) {
                    sendBtn = document.querySelector('.msg-form__send-button');
                } else if (url.includes('whatsapp.com')) {
                    sendBtn = document.querySelector('button[data-testid="compose-btn-send"]') ||
                              document.querySelector('[data-testid="send"]') ||
                              document.querySelector('button span[data-icon="send"]')?.parentElement;
                } else if (url.includes('mail.google.com')) {
                    sendBtn = document.querySelector('.T-I.J-J5-Ji.aoO.v7.T-I-atl.L3') ||
                              document.querySelector('div[role="button"][aria-label="Send message"]');
                } else if (url.includes('slack.com')) {
                    sendBtn = document.querySelector('.c-button-unstyled.c-icon_button--light.c-icon_button--size_medium.p-message_input__send');
                } else if (url.includes('chat.google.com')) {
                    sendBtn = document.querySelector('div[role="button"][aria-label="Send message"], button[aria-label="Send message"], [data-tooltip="Send message"]');
                }

                if (sendBtn && !sendBtn.disabled) {
                    console.log(`[RefineAI content.js] Send button found. Clicking send (attempt ${attempts + 1})...`);
                    sendBtn.click();
                    sendResponse({ status: "success" });
                    return;
                }

                if (attempts < 10) {
                    console.log(`[RefineAI content.js] Send button not found or disabled. Retrying in 100ms... (attempt ${attempts + 1}/10)`);
                    setTimeout(() => findAndClickSend(attempts + 1), 100);
                } else {
                    console.warn('[RefineAI content.js] Send button not found or disabled after 10 attempts. Falling back to Enter key...');
                    // Fallback to Enter key
                    const active = document.activeElement;
                    if (active) {
                        active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                    }
                    sendResponse({ status: "success", info: "Attempted Enter key fallback" });
                }
            } catch (err) {
                console.error('[RefineAI content.js] Error in findAndClickSend:', err);
                sendResponse({ status: "error", message: err.message });
            }
        };

        findAndClickSend();
        return true; // Keep message channel open for async response
    }
    return true;
});
