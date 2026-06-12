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
                    // WhatsApp Specific: Monitor the main message list container directly if possible, 
                    // or look for specific new message class signatures in added nodes.
                    if (mutation.target.getAttribute('role') === 'application' ||
                        mutation.target.classList.contains('_3K4-L') || // Common container class
                        document.querySelector('.message-in, .message-out')) {
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

// Content Script for Inserting Text
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "INSERT_TEXT") {
        const activeElement = document.activeElement;

        if (activeElement) {
            const isContentEditable = activeElement.contentEditable === 'true' || activeElement.role === 'textbox';

            if (isContentEditable) {
                // Focus and execute insertText
                activeElement.focus();
                const selection = window.getSelection();
                if (!selection.rangeCount) return;

                // For modern reactive editors, we need to be careful
                document.execCommand('insertText', false, request.text);

                // Fallback / Trigger events
                activeElement.dispatchEvent(new Event('input', { bubbles: true }));
                activeElement.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (activeElement.tagName === 'TEXTAREA' || (activeElement.tagName === 'INPUT' && activeElement.type === 'text')) {
                const start = activeElement.selectionStart;
                const end = activeElement.selectionEnd;
                const text = activeElement.value;
                activeElement.value = text.slice(0, start) + request.text + text.slice(end);
                activeElement.selectionStart = activeElement.selectionEnd = start + request.text.length;
                activeElement.dispatchEvent(new Event('input', { bubbles: true }));
                activeElement.dispatchEvent(new Event('change', { bubbles: true }));
            }
            sendResponse({ status: "success" });
        } else {
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
            } else if (url.includes('web.whatsapp.com')) {
                // Improved WhatsApp Selectors
                const waMessages = document.querySelectorAll('.message-in, .message-out');
                // Title is tricky in WA, it's often in the header
                const titleEl = document.querySelector('#main header span[dir="auto"], #main header ._amig, header canvas + div span');
                if (titleEl) chatTitle = titleEl.innerText.trim() || titleEl.getAttribute('title');

                messages = Array.from(waMessages).map(m => {
                    const isMe = m.classList.contains('message-out') ||
                        m.querySelector('[data-icon="msg-dblcheck"]') ||
                        m.querySelector('[data-icon="msg-check"]') ||
                        m.querySelector('[data-icon="msg-dblcheck-ack"]');

                    const textEl = m.querySelector('.selectable-text.copyable-text span') ||
                        m.querySelector('.copyable-text span') ||
                        m.querySelector('._ao3e');

                    let text = textEl ? textEl.innerText.trim() : m.innerText.trim();
                    text = text.replace(/\d{1,2}:\d{2}\s?(AM|PM|am|pm)?$/g, '').trim();

                    return { text, sender: isMe ? 'Me' : 'Them' };
                });
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
        try {
            const url = window.location.href;
            let sendBtn = null;

            if (url.includes('linkedin.com')) {
                sendBtn = document.querySelector('.msg-form__send-button');
            } else if (url.includes('whatsapp.com')) {
                sendBtn = document.querySelector('button span[data-icon="send"]')?.parentElement;
            } else if (url.includes('mail.google.com')) {
                sendBtn = document.querySelector('.T-I.J-J5-Ji.aoO.v7.T-I-atl.L3');
                // Could also be chat in mail
                if (!sendBtn) sendBtn = document.querySelector('div[role="button"][aria-label="Send message"]');
            } else if (url.includes('slack.com')) {
                sendBtn = document.querySelector('.c-button-unstyled.c-icon_button--light.c-icon_button--size_medium.p-message_input__send');
            } else if (url.includes('chat.google.com')) {
                sendBtn = document.querySelector('div[role="button"][aria-label="Send message"], button[aria-label="Send message"], [data-tooltip="Send message"]');
            }

            if (sendBtn) {
                sendBtn.click();
                sendResponse({ status: "success" });
            } else {
                // Try Enter key as fallback
                const active = document.activeElement;
                active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                sendResponse({ status: "success", info: "Attempted Enter key fallback" });
            }
        } catch (e) {
            sendResponse({ status: "error", message: e.message });
        }
    }
    return true;
});
