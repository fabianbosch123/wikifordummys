/**
 * Macht aus einer Browser-Kennung (User-Agent) eine lesbare Beschreibung wie „Chrome unter Linux“.
 * Nur zur Anzeige unter „Angemeldete Geräte“; die Kennung kommt vom Browser und ist nicht vertrauenswürdig,
 * deshalb werden nur bekannte Namen aus festen Listen zurückgegeben und nie Teile der Kennung selbst.
 */

// Reihenfolge wichtig: Edge, Opera und Samsung tragen auch „Chrome“ in der Kennung, Chrome trägt auch „Safari“
const BROWSERS: [RegExp, string][] = [
  [/\bEdg(e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\b/, 'Opera'],
  [/\bVivaldi\//, 'Vivaldi'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bChrome\/|\bCriOS\/|\bChromium\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
  [/\bcurl\//, 'curl'],
];

// Android vor Linux (Android-Kennungen enthalten „Linux“), iPhone/iPad vor macOS („like Mac OS X“)
const SYSTEMS: [RegExp, string][] = [
  [/\bAndroid\b/, 'unter Android'],
  [/\biPhone\b/, 'auf dem iPhone'],
  [/\biPad\b/, 'auf dem iPad'],
  [/\bWindows\b/, 'unter Windows'],
  [/\bCrOS\b/, 'unter ChromeOS'],
  [/\bMacintosh\b|\bMac OS X\b/, 'unter macOS'],
  [/\bLinux\b|\bX11\b/, 'unter Linux'],
];

const match = (list: [RegExp, string][], ua: string) => list.find(([re]) => re.test(ua))?.[1];

export function describeUserAgent(ua: string | null | undefined): string {
  const value = (ua ?? '').slice(0, 1000);
  const browser = match(BROWSERS, value);
  const system = match(SYSTEMS, value);
  if (browser && system) return `${browser} ${system}`;
  if (browser) return browser;
  if (system) return `Browser ${system}`;
  return 'Unbekanntes Gerät';
}
