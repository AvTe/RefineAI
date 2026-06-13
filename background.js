chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "refineText",
        title: "Refine with RefineAI",
        contexts: ["selection"]
    });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "refineText") {
        // Save text in storage to handle startup race conditions
        if (chrome.storage?.local) {
            await chrome.storage.local.set({ pendingRefineText: info.selectionText });
        }

        // Open the side panel
        chrome.sidePanel.open({ tabId: tab.id }).catch((err) => console.error(err));

        // Send immediately in case the panel is already open
        chrome.runtime.sendMessage({
            type: "REFINE_TEXT",
            text: info.selectionText
        }).catch(() => {
            // Ignore error when side panel is not yet open
        });
    }
});
