// Applies the saved theme before first paint (loaded as a classic, blocking
// script in <head>). "system" (no attribute) follows the OS setting.
try {
  const theme = localStorage.getItem("flowRecorderTheme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch {
  // storage unavailable: follow the OS
}
