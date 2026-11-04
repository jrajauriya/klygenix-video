export function deviceName(ua: string = navigator.userAgent): string {
  if (/\bAFT[A-Z0-9]|Fire ?TV/i.test(ua)) return "Fire TV"
  if (/Tizen|SMART-TV.*Samsung|Samsung.*SMART-TV|SamsungBrowser.*TV/i.test(ua)) return "Samsung TV"
  if (/Web0S|webOS|NetCast|LG Browser|\bLGE\b/i.test(ua)) return "LG TV"
  if (/Android/i.test(ua) && /\bTV\b|GoogleTV|Google TV|BRAVIA|SHIELD|Chromecast|MiTV|MIBOX|AndroidTV/i.test(ua)) return "Android TV"
  return "TV browser"
}
