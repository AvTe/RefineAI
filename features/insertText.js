// Feature: Insert Text into Browser Page
(function () {
    const insertBtn = document.getElementById('insert-btn');
    const insertEmailBtn = document.getElementById('insert-email-btn');
    const outputText = document.getElementById('output-text');
    const emailOutputText = document.getElementById('email-output-text');

    window.insertTextIntoPage = async function (text) {
        if (!text) return false;

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
