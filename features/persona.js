// Feature: Persona & Brand Voice
(function () {
    const personaInput = document.getElementById('persona-input');
    const savePersonaBtn = document.getElementById('save-persona-btn');

    // Load saved persona
    const savedPersona = localStorage.getItem('user_persona');
    if (savedPersona && personaInput) {
        personaInput.value = savedPersona;
    }

    if (savePersonaBtn) {
        savePersonaBtn.addEventListener('click', () => {
            const persona = personaInput.value.trim();
            localStorage.setItem('user_persona', persona);
            showToast("Persona saved successfully!", "success");
        });
    }

    // Export persona globally for main script to use
    window.getUserPersona = () => {
        return localStorage.getItem('user_persona') || "";
    };
})();
