// Cute kawaii food illustrations for the checklist (inline SVG, no image files).
// These are static constants written here, never built from user or server data.

const KAWAII = (() => {
  const ink = "#3b2a2a";

  // Shared face: two shiny eyes, rosy cheeks, little smile.
  function face(cx, cy, { gap = 6, eye = ink, size = 1 } = {}) {
    const r = 2.3 * size;
    return `
      <circle cx="${cx - gap}" cy="${cy}" r="${r}" fill="${eye}"/>
      <circle cx="${cx + gap}" cy="${cy}" r="${r}" fill="${eye}"/>
      <circle cx="${cx - gap + 0.8 * size}" cy="${cy - 0.8 * size}" r="${0.8 * size}" fill="#fff"/>
      <circle cx="${cx + gap + 0.8 * size}" cy="${cy - 0.8 * size}" r="${0.8 * size}" fill="#fff"/>
      <ellipse cx="${cx - gap - 3.5 * size}" cy="${cy + 3.5 * size}" rx="${2.8 * size}" ry="${1.6 * size}" fill="#ff8fa3" opacity=".75"/>
      <ellipse cx="${cx + gap + 3.5 * size}" cy="${cy + 3.5 * size}" rx="${2.8 * size}" ry="${1.6 * size}" fill="#ff8fa3" opacity=".75"/>
      <path d="M${cx - 2.5 * size} ${cy + 2.5 * size} q${2.5 * size} ${2.6 * size} ${5 * size} 0"
            stroke="${eye}" stroke-width="${1.6 * size}" fill="none" stroke-linecap="round"/>`;
  }

  const svg = (body) => `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

  const art = {
    "bottle": svg(`
      <rect x="26" y="6" width="12" height="8" rx="2" fill="#3a86ff"/>
      <path d="M24 16 h16 l4 8 v28 a6 6 0 0 1 -6 6 h-12 a6 6 0 0 1 -6 -6 v-28 z" fill="#9ad8ff" stroke="#5fb3e8" stroke-width="1.5"/>
      <rect x="20" y="30" width="24" height="9" fill="#ffffff" opacity=".75"/>
      <path d="M27 20 v6" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".8"/>
      ${face(32, 46)}`),

    "energy drink": svg(`
      <ellipse cx="32" cy="10" rx="12" ry="3.5" fill="#c9ced6"/>
      <rect x="20" y="10" width="24" height="46" rx="5" fill="#1d1f22"/>
      <ellipse cx="32" cy="56" rx="12" ry="3" fill="#2b2e33"/>
      <path d="M26 16 l2 14 M32 15 l0 15 M38 16 l-2 14" stroke="#4dff4d" stroke-width="3" stroke-linecap="round"/>
      ${face(32, 42, { eye: "#ffffff" })}`),

    "can": svg(`
      <ellipse cx="32" cy="11" rx="12" ry="3.5" fill="#d5d9e0"/>
      <rect x="20" y="11" width="24" height="44" rx="5" fill="#ff5a5f"/>
      <path d="M20 26 q6 -5 12 0 t12 0" stroke="#fff" stroke-width="3" fill="none"/>
      <ellipse cx="32" cy="55" rx="12" ry="3" fill="#e0484d"/>
      ${face(32, 40, { eye: "#ffffff" })}`),

    "tofu": svg(`
      <path d="M14 24 l8 -8 h28 l-8 8 z" fill="#fffef6" stroke="#e6d7b0" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M42 24 l8 -8 v28 l-8 8 z" fill="#f3e6c3" stroke="#e6d7b0" stroke-width="1.5" stroke-linejoin="round"/>
      <rect x="14" y="24" width="28" height="28" rx="3" fill="#fff9e8" stroke="#e6d7b0" stroke-width="1.5"/>
      ${face(28, 37, { gap: 5 })}`),

    "salad": svg(`
      <circle cx="22" cy="28" r="9" fill="#7ed957"/>
      <circle cx="33" cy="23" r="10" fill="#5cc93a"/>
      <circle cx="43" cy="29" r="8" fill="#8fe36a"/>
      <circle cx="28" cy="25" r="3.5" fill="#ff5a5f"/>
      <circle cx="40" cy="24" r="3" fill="#ffb703"/>
      <path d="M10 32 h44 a22 22 0 0 1 -44 0 z" fill="#ffffff" stroke="#9adbd0" stroke-width="2"/>
      <path d="M12 36 h40" stroke="#7fd8be" stroke-width="3"/>
      ${face(32, 45)}`),

    "knife": svg(`
      <path d="M27 6 q12 4 12 22 v12 h-12 z" fill="#e9eef4" stroke="#aebccb" stroke-width="1.5" stroke-linejoin="round"/>
      <rect x="26" y="40" width="14" height="19" rx="5" fill="#a0673f"/>
      <circle cx="33" cy="46" r="1.4" fill="#e9c9a9"/><circle cx="33" cy="53" r="1.4" fill="#e9c9a9"/>
      ${face(33, 25, { gap: 3.5, size: 0.75 })}`),

    "fork": svg(`
      <path d="M23 6 v12 M29 6 v12 M35 6 v12 M41 6 v12" stroke="#c4ced9" stroke-width="3.2" stroke-linecap="round"/>
      <rect x="21" y="15" width="22" height="16" rx="7" fill="#e9eef4" stroke="#aebccb" stroke-width="1.5"/>
      <rect x="28" y="30" width="8" height="28" rx="4" fill="#e9eef4" stroke="#aebccb" stroke-width="1.5"/>
      ${face(32, 22, { gap: 4.5, size: 0.8 })}`),

    "spoon": svg(`
      <ellipse cx="32" cy="20" rx="13" ry="15" fill="#e9eef4" stroke="#aebccb" stroke-width="1.5"/>
      <ellipse cx="28" cy="14" rx="3" ry="5" fill="#fff" opacity=".8"/>
      <rect x="28" y="33" width="8" height="25" rx="4" fill="#e9eef4" stroke="#aebccb" stroke-width="1.5"/>
      ${face(32, 21, { gap: 5, size: 0.85 })}`),

    "sandwich": svg(`
      <path d="M8 46 L32 12 L56 46 z" fill="#f7d9a0" stroke="#d9a35b" stroke-width="2" stroke-linejoin="round"/>
      <path d="M10 44 q5 -4 9 0 t9 0 t9 0 t9 0 t9 0" stroke="#6ccf5a" stroke-width="4" fill="none" stroke-linecap="round"/>
      <rect x="9" y="46" width="46" height="5" rx="2" fill="#ff6b6b"/>
      <rect x="8" y="51" width="48" height="6" rx="3" fill="#f7d9a0" stroke="#d9a35b" stroke-width="2"/>
      ${face(32, 34)}`),

    "sauce cup": svg(`
      <path d="M14 26 h36 l-5 26 a4 4 0 0 1 -4 3 h-18 a4 4 0 0 1 -4 -3 z" fill="#ffffff" stroke="#c9d3de" stroke-width="2"/>
      <ellipse cx="32" cy="26" rx="18" ry="5" fill="#fff4cc" stroke="#e8d79a" stroke-width="1.5"/>
      <circle cx="26" cy="25" r="1.2" fill="#7ed957"/><circle cx="36" cy="26" r="1.2" fill="#7ed957"/>
      ${face(32, 40)}`),

    "donut": svg(`
      <circle cx="32" cy="34" r="22" fill="#f2b56b"/>
      <path d="M12 32 a20 18 0 0 1 40 0 q-4 6 -8 2 q-4 6 -8 1 q-4 6 -8 1 q-4 6 -8 1 q-4 5 -8 -5z" fill="#ff8fb8"/>
      <ellipse cx="32" cy="27" rx="6" ry="4" fill="#fffaf0"/>
      <path d="M20 22 l3 -2 M42 21 l3 2 M24 31 l2 2 M40 31 l-2 2 M31 18 l2 -1" stroke="#7bdff2" stroke-width="2" stroke-linecap="round"/>
      ${face(32, 42)}`),

    "apple": svg(`
      <path d="M32 18 q-4 -8 -2 -12" stroke="#7a4a2a" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M33 14 q8 -8 14 -4 q-6 8 -14 4z" fill="#6ccf5a"/>
      <path d="M32 20 c-10 -6 -22 0 -22 14 c0 12 10 22 22 20 c12 2 22 -8 22 -20 c0 -14 -12 -20 -22 -14z" fill="#ff5a5f"/>
      <ellipse cx="22" cy="28" rx="3" ry="5" fill="#fff" opacity=".5"/>
      ${face(32, 38)}`),

    "banana": svg(`
      <path d="M10 22 q4 28 30 30 q12 0 16 -6 q-22 2 -36 -26 z" fill="#ffd93d" stroke="#e0b520" stroke-width="2" stroke-linejoin="round"/>
      <path d="M8 18 l4 5" stroke="#7a5a1a" stroke-width="3" stroke-linecap="round"/>
      ${face(30, 40, { gap: 4.5, size: 0.85 })}`),

    "orange": svg(`
      <circle cx="32" cy="36" r="21" fill="#ffa62b"/>
      <path d="M32 15 q2 -5 0 -8" stroke="#7a4a2a" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M33 13 q9 -6 13 0 q-7 6 -13 0z" fill="#6ccf5a"/>
      <circle cx="24" cy="26" r="1" fill="#e08a12"/><circle cx="41" cy="28" r="1" fill="#e08a12"/><circle cx="44" cy="44" r="1" fill="#e08a12"/>
      <ellipse cx="22" cy="30" rx="3" ry="5" fill="#fff" opacity=".4"/>
      ${face(32, 38)}`),

    "pizza": svg(`
      <path d="M8 14 q24 -8 48 0 L32 58 z" fill="#ffd166" stroke="#e9a03b" stroke-width="2" stroke-linejoin="round"/>
      <path d="M8 14 q24 -8 48 0" stroke="#e9a03b" stroke-width="6" fill="none" stroke-linecap="round"/>
      <circle cx="24" cy="24" r="4" fill="#e63946"/><circle cx="41" cy="23" r="4" fill="#e63946"/><circle cx="33" cy="44" r="3.5" fill="#e63946"/>
      ${face(32, 31, { gap: 5, size: 0.85 })}`),

    "hot dog": svg(`
      <rect x="6" y="30" width="52" height="18" rx="9" fill="#f4b860" stroke="#d9963a" stroke-width="2"/>
      <rect x="4" y="25" width="56" height="12" rx="6" fill="#e5533d"/>
      <path d="M10 29 q4 -3 8 0 t8 0 t8 0 t8 0 t8 0 t8 0" stroke="#ffd93d" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      ${face(32, 40, { gap: 5, size: 0.85 })}`),
  };

  // Parse each static SVG string once; callers get a fresh clone.
  const cache = {};
  return function icon(label) {
    if (!art[label]) return null;
    if (!cache[label]) {
      const t = document.createElement("template");
      t.innerHTML = art[label].trim(); // static constant above, not user data
      cache[label] = t.content.firstChild;
    }
    return cache[label].cloneNode(true);
  };
})();
