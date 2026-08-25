export function generatePassword(length = 10) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

const TRANSLIT_MAP = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

// Юридические формы отбрасываем — они не помогают отличить один логин от
// другого и только удлиняют его (ООО «Ромашка» и АО «Ромашка» иначе дадут
// один и тот же логин с точностью до этих букв).
const LEGAL_FORM_WORDS = /^(ооо|зао|оао|пао|ао|ип|нко|тоо)$/i;

export function generateUsernameFromName(name, maxLength = 18) {
  const words = (name || '')
    .toLowerCase()
    .replace(/["«»']/g, ' ')
    .split(/[^a-zа-яё0-9]+/i)
    .filter((w) => w && !LEGAL_FORM_WORDS.test(w));

  const translit = words
    .join('')
    .split('')
    .map((ch) => (ch in TRANSLIT_MAP ? TRANSLIT_MAP[ch] : /[a-z0-9]/.test(ch) ? ch : ''))
    .join('');

  return translit.slice(0, maxLength) || 'company';
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(textarea);
    return ok;
  }
}

let toastTimer = null;
export function showToast(message, type = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `toast toast--${type} is-visible`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2800);
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value !== undefined && value !== null) {
      node.setAttribute(key, value);
    }
  }
  for (const child of [].concat(children)) {
    if (child) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function fallbackAvatar(name) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
    <rect width="200" height="200" fill="#1a2340"/>
    <text x="50%" y="53%" font-family="Arial, sans-serif" font-size="84" fill="#5b8def"
      text-anchor="middle" dominant-baseline="middle">${initial}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

const COMPANY_SESSION_KEY = 'biz_match_company_session';
const ADMIN_SESSION_KEY = 'biz_match_admin_session';

export function saveCompanySession(session) {
  localStorage.setItem(COMPANY_SESSION_KEY, JSON.stringify(session));
}
export function getCompanySession() {
  try {
    return JSON.parse(localStorage.getItem(COMPANY_SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}
export function clearCompanySession() {
  localStorage.removeItem(COMPANY_SESSION_KEY);
}

export function saveAdminSession(token) {
  localStorage.setItem(ADMIN_SESSION_KEY, token);
}
export function getAdminSession() {
  return localStorage.getItem(ADMIN_SESSION_KEY);
}
export function clearAdminSession() {
  localStorage.removeItem(ADMIN_SESSION_KEY);
}

export function timeAgo(isoString) {
  if (!isoString) return '';
  const diffMs = Date.now() - new Date(isoString).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ч назад`;
  const day = Math.floor(hr / 24);
  return `${day} дн назад`;
}
