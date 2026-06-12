// Theme initialization to prevent light-theme flash
(function () {
  const savedTheme = localStorage.getItem('theme');
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = savedTheme === 'dark' || (!savedTheme && systemPrefersDark);
  if (isDark) {
    document.documentElement.classList.add('dark-theme');
  } else {
    document.documentElement.classList.add('light-theme');
  }
})();
