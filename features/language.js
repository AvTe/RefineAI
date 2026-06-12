// Feature: Language & Translation
(function () {
    const languageSelect = document.getElementById('target-language');

    // Save preference
    const savedLang = localStorage.getItem('target_language');
    if (savedLang && languageSelect) {
        languageSelect.value = savedLang;
    }

    if (languageSelect) {
        languageSelect.addEventListener('change', () => {
            localStorage.setItem('target_language', languageSelect.value);
            if (languageSelect.value) {
                showToast(`Target set to ${languageSelect.value}`, "info");
            }
        });
    }

    // Export language globally
    window.getTargetLanguage = () => {
        return languageSelect ? languageSelect.value : "";
    };
})();
