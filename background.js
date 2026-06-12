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

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "refineText") {
        // Open the side panel if it's not already open
        chrome.sidePanel.open({ tabId: tab.id });

        // Give it a tiny bit of time to initialize if it just opened
        setTimeout(() => {
            chrome.runtime.sendMessage({
                type: "REFINE_TEXT",
                text: info.selectionText
            });
        }, 500);
    }
});
