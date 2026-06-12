// Feature: Right-Click Selection Handler
(function () {
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.type === "REFINE_TEXT") {
                const inputText = document.getElementById('input-text');
                const mainView = document.getElementById('main-view');
                const views = document.querySelectorAll('.view');

                if (inputText) {
                    // Fill the text
                    inputText.value = message.text;

                    // Trigger input event for word count and auto-resize
                    inputText.dispatchEvent(new Event('input', { bubbles: true }));

                    if (window.switchView) window.switchView('main');

                    // If it's the email writer, we might want to fill context instead?
                    // But generally, the user wants to "Refine", which is main view.

                    // Scroll to top
                    document.querySelector('.app-main').scrollTop = 0;
                }
            }
        });
    }
})();
