// Feature: Right-Click Selection Handler
(function () {
    const handleRefineText = (text) => {
        const inputText = document.getElementById('input-text');
        if (inputText) {
            inputText.value = text;
            inputText.dispatchEvent(new Event('input', { bubbles: true }));
            if (window.switchView) window.switchView('main');
            const appMain = document.querySelector('.app-main');
            if (appMain) appMain.scrollTop = 0;
        }
    };

    if (typeof chrome !== 'undefined') {
        // 1. Listen for runtime messages (when panel is already open)
        if (chrome.runtime?.onMessage) {
            chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
                if (message.type === "REFINE_TEXT") {
                    handleRefineText(message.text);
                    // Clear pending text from storage so a subsequent reload doesn't trigger it again
                    chrome.storage.local.remove('pendingRefineText');
                }
            });
        }

        // 2. Check storage on startup (when panel just opened)
        if (chrome.storage?.local) {
            chrome.storage.local.get('pendingRefineText', (data) => {
                if (data.pendingRefineText) {
                    handleRefineText(data.pendingRefineText);
                    chrome.storage.local.remove('pendingRefineText');
                }
            });
        }
    }
})();
