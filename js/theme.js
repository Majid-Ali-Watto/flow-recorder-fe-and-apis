// Theme toggle shared by all extension pages: system → light → dark.
const KEY = "flowRecorderTheme";
const ORDER = ["system", "light", "dark"];

const ICONS = {
  system:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  light:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
};

function current() {
  try {
    const t = localStorage.getItem(KEY);
    return ORDER.includes(t) ? t : "system";
  } catch {
    return "system";
  }
}

function apply(theme) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export function mountThemeToggle(button) {
  if (!button) return;
  const render = () => {
    const theme = current();
    button.innerHTML = ICONS[theme]; // static, trusted markup
    button.title = `Theme: ${theme} (click to change)`;
    button.setAttribute("aria-label", button.title);
  };
  button.addEventListener("click", () => {
    const next = ORDER[(ORDER.indexOf(current()) + 1) % ORDER.length];
    try {
      localStorage.setItem(KEY, next);
    } catch {}
    apply(next);
    render();
  });
  // keep other open extension pages in sync
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    apply(current());
    render();
  });
  render();
}
