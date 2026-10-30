import type { ThemePreference } from '@wiki/shared';

/**
 * Darstellung hell/dunkel. Die Einstellung gehört zum Benutzerkonto (Datenbank); das Cookie merkt sie sich nur,
 * damit der Server die nächste Seite gleich in der richtigen Darstellung ausliefert und nichts aufblitzt.
 * Ohne Attribut data-theme folgt die Oberfläche dem Betriebssystem (prefers-color-scheme).
 */
export const THEME_COOKIE = 'wiki_theme';

/** Wert aus dem Cookie für das Attribut data-theme; alles andere heißt System */
export function themeAttribute(value: string | undefined): 'light' | 'dark' | undefined {
  return value === 'light' || value === 'dark' ? value : undefined;
}

export function applyTheme(theme: ThemePreference) {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie =
    theme === 'system'
      ? `${THEME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
      : `${THEME_COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

/** Tatsächlich angezeigte Darstellung, z. B. für eingebettete Editoren, die kein „System“ kennen */
export function resolveTheme(theme: ThemePreference): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const THEME_LABELS: Record<ThemePreference, string> = { system: 'System', light: 'Hell', dark: 'Dunkel' };
