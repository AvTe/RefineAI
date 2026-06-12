// Feature: Insert Text into Browser Page
(function () {
    const insertBtn = document.getElementById('insert-btn');
    const insertEmailBtn = document.getElementById('insert-email-btn');
    const outputText = document.getElementById('output-text');
    const emailOutputText = document.getElementById('email-output-text');

    const getActiveTab = async () => {
        try {
            if (typeof chrome === 'undefined' || !chrome.tabs?.query) return null;
            let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.url) return tab;
            const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            if (tabs && tabs.length > 0 && tabs[0].url) return tabs[0];
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
            console.warn('[RefineAI] getActiveTab failed in insertText.js:', e);
            return null;
        }
    };

    window.insertTextIntoPage = async function (text) {
        if (!text) return false;

        try {
            const tab = await getActiveTab();
            if (!tab) return false;

            const response = await chrome.tabs.sendMessage(tab.id, {
                action: "INSERT_TEXT",
                text: text
            });

            if (response && response.status === "success") {
                showToast("Inserted into page!", "success");
                return true;
            } else if (response && response.status === "no_active_element") {
                showToast("Click a text box on the page first!", "error");
                return false;
            } else {
                showToast("Could not insert text.", "error");
                return false;
            }
        } catch (error) {
            console.error("Insert error:", error);
            showToast("Make sure a valid page is open.", "error");
            return false;
        }
    };

    if (insertBtn) {
        insertBtn.addEventListener('click', () => window.insertTextIntoPage(outputText.value));
    }

    if (insertEmailBtn) {
        insertEmailBtn.addEventListener('click', () => window.insertTextIntoPage(emailOutputText.value));
    }
})();
