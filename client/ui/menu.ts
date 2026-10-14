export interface MenuActions {
  onPractice(): void;
  onCreate(): void;
  onJoin(code: string): void;
  onSignInDemo(n: 1 | 2): void;
  onPlayAsGuest(): void;
}

/** One sport on the home screen. Adding a sport is one entry in SPORTS. */
export interface Sport {
  id: string;
  name: string;
  /** Only playable sports can be selected or start anything on the server. */
  playable: boolean;
  blurb: string;
  /** Small inline-SVG badge for the sport's button (its ball or kit). */
  icon: string;
  /** Markup for the framed preview: inline SVG and DOM only, no images, no Three.js. */
  thumbnail(): string;
}

const icon = (body: string): string =>
  `<svg class="sport-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;

const ICONS = {
  tennis: icon(
    `<circle cx="12" cy="12" r="10" fill="#d8f03c" stroke="#8fa61a" stroke-width="1.2"/><path d="M4.5 5.5c4 3 4 10 0 13M19.5 5.5c-4 3-4 10 0 13" fill="none" stroke="#fff" stroke-width="1.8"/>`,
  ),
  baseball: icon(
    `<circle cx="12" cy="12" r="10" fill="#fff" stroke="#9aa5b1" stroke-width="1.2"/><path d="M6 4.5c2.5 4 2.5 11 0 15M18 4.5c-2.5 4-2.5 11 0 15" fill="none" stroke="#e03131" stroke-width="1.4" stroke-dasharray="1.6 1.4"/>`,
  ),
  bowling: icon(
    `<path d="M12 2c2 0 2.6 2 2 4.5-.4 1.6 3 5 3 9.5 0 3.5-2 6-5 6s-5-2.5-5-6c0-4.5 3.4-7.9 3-9.5C9.4 4 10 2 12 2z" fill="#fff" stroke="#9aa5b1" stroke-width="1.2"/><path d="M9.6 7.6h4.8" stroke="#e03131" stroke-width="1.6"/>`,
  ),
  golf: icon(
    `<path d="M7 22V3" stroke="#495057" stroke-width="1.6"/><path d="M7.8 3.5l10 3.8-10 3.8z" fill="#ff4d4d"/><ellipse cx="11" cy="21.5" rx="7" ry="1.6" fill="#69bb55"/>`,
  ),
  boxing: icon(
    `<path d="M6 10c0-4 2.8-7 6.5-7S19 5.5 19 9.5c0 3-1.2 5-3 6v3H8v-3.5C6.8 14 6 12.4 6 10z" fill="#e03131" stroke="#a61e1e" stroke-width="1.1"/><rect x="7.5" y="18" width="9" height="3.5" rx="1" fill="#f8f9fa" stroke="#9aa5b1"/>`,
  ),
};

// Two decorative Mii-style figures that take turns crossing the tennis
// preview: a runner, then (later in the same loop) a server who stops to
// toss, swing and send the ball off before running on. Pure CSS/DOM, so the
// menu never pulls in Three.js (that stays lazy, loaded only once a game
// starts). Their keyframes use container units, so they cross the preview
// frame, not the window.
const sprite = (role: "runner" | "server"): string => `
  <div class="sprite sprite--${role}" aria-hidden="true">
    <div class="sprite-shadow"></div>
    <div class="sprite-body">
      <div class="sprite-leg sprite-leg--l"></div>
      <div class="sprite-leg sprite-leg--r"></div>
      <div class="sprite-torso"></div>
      <div class="sprite-arm sprite-arm--off"></div>
      <div class="sprite-arm sprite-arm--main"><div class="sprite-racket"></div></div>
      <div class="sprite-head"><div class="sprite-hair"></div></div>
    </div>
    ${role === "server" ? '<div class="sprite-ball"></div>' : ""}
  </div>
`;

const svg = (body: string): string =>
  `<svg class="thumb-svg" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${body}</svg>`;

const sky = (top: string, bottom: string): string => `
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/>
  </linearGradient></defs>
  <rect width="320" height="180" fill="url(#sky)"/>
  <ellipse cx="60" cy="22" rx="26" ry="8" fill="#fff" opacity=".85"/>
  <ellipse cx="250" cy="16" rx="34" ry="9" fill="#fff" opacity=".8"/>
`;

/** Blocky, multicoloured crowd patches across a stand, as in the arena. */
function crowd(y: number, rows: number, x0: number, x1: number): string {
  const colours = ["#ff6b6b", "#ffd166", "#4dabf7", "#f8f9fa", "#69db7c", "#b197fc", "#ffa94d"];
  let out = "";
  for (let r = 0; r < rows; r++) {
    for (let x = x0, i = r * 3; x < x1; x += 9, i++) {
      out += `<rect x="${x}" y="${y + r * 7}" width="7" height="5" rx="1" fill="${colours[(i * 5 + r) % colours.length]}"/>`;
    }
  }
  return out;
}

// A low-poly court in perspective: stands, low green wall, mown stripes,
// white lines, a translucent net and an orange ball with its shadow.
function tennisThumb(): string {
  // court corners: far baseline 112..208 at y 86, near baseline 22..298 at y 176
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const edge = (t: number) => ({ y: lerp(86, 176, t), l: lerp(112, 22, t), r: lerp(208, 298, t) });
  let stripes = "";
  for (let i = 0; i < 8; i++) {
    const a = edge(i / 8);
    const b = edge((i + 1) / 8);
    stripes += `<polygon points="${a.l},${a.y} ${a.r},${a.y} ${b.r},${b.y} ${b.l},${b.y}" fill="${i % 2 ? "#5aa847" : "#68b553"}"/>`;
  }
  const singles = (t: number, side: -1 | 1) => {
    const e = edge(t);
    const inset = (e.r - e.l) * 0.11;
    return side < 0 ? e.l + inset : e.r - inset;
  };
  const line = (t0: number, t1: number, side: -1 | 1) =>
    `<line x1="${singles(t0, side)}" y1="${edge(t0).y}" x2="${singles(t1, side)}" y2="${edge(t1).y}"/>`;
  const across = (t: number, inner = false) => {
    const e = edge(t);
    return inner
      ? `<line x1="${singles(t, -1)}" y1="${e.y}" x2="${singles(t, 1)}" y2="${e.y}"/>`
      : `<line x1="${e.l}" y1="${e.y}" x2="${e.r}" y2="${e.y}"/>`;
  };
  const net = edge(0.47);
  const service = [0.24, 0.72];
  const mid = (t: number) => (edge(t).l + edge(t).r) / 2;
  return `
    <div class="thumb-art">
      ${svg(`
        ${sky("#4ea3ea", "#cfeafc")}
        <polygon points="0,38 320,38 320,78 0,78" fill="#7b8ea3"/>
        ${crowd(42, 5, 4, 316)}
        <rect y="76" width="320" height="10" fill="#2f8f4e"/>
        <rect y="86" width="320" height="94" fill="#4c9a3f"/>
        ${stripes}
        <g stroke="#fff" stroke-width="1.6" stroke-linecap="round" fill="none">
          <polygon points="112,86 208,86 298,176 22,176"/>
          ${line(0, 1, -1)}${line(0, 1, 1)}
          ${across(service[0], true)}${across(service[1], true)}
          <line x1="${mid(service[0])}" y1="${edge(service[0]).y}" x2="${mid(service[1])}" y2="${edge(service[1]).y}"/>
        </g>
        <rect x="${net.l - 4}" y="${net.y - 13}" width="${net.r - net.l + 8}" height="13" fill="#1d2b36" opacity=".35"/>
        <line x1="${net.l - 4}" y1="${net.y - 13}" x2="${net.r + 4}" y2="${net.y - 13}" stroke="#fff" stroke-width="2"/>
        <rect x="${net.l - 6}" y="${net.y - 15}" width="2.5" height="16" fill="#e9ecef"/>
        <rect x="${net.r + 3.5}" y="${net.y - 15}" width="2.5" height="16" fill="#e9ecef"/>
        <ellipse cx="196" cy="146" rx="5" ry="1.8" fill="#000" opacity=".25"/>
        <circle cx="203" cy="122" r="3.4" fill="#ffb21c" stroke="#e8890c" stroke-width=".8"/>
      `)}
      <div class="thumb-sprites">${sprite("runner")}${sprite("server")}</div>
    </div>`;
}

function baseballThumb(): string {
  return `<div class="thumb-art">${svg(`
    ${sky("#5fb0ee", "#d6eefc")}
    ${crowd(30, 4, 0, 320)}
    <rect y="58" width="320" height="122" fill="#4f9e3d"/>
    <path d="M160 176 L60 96 Q160 52 260 96 Z" fill="#c98b52"/>
    <polygon points="160,160 206,124 160,96 114,124" fill="#5aa847" stroke="#fff" stroke-width="1.6"/>
    <g fill="#fff"><rect x="156" y="156" width="8" height="8" transform="rotate(45 160 160)"/>
    <rect x="202" y="120" width="7" height="7" transform="rotate(45 206 124)"/>
    <rect x="156" y="92" width="7" height="7" transform="rotate(45 160 96)"/>
    <rect x="110" y="120" width="7" height="7" transform="rotate(45 114 124)"/></g>
    <circle cx="160" cy="128" r="7" fill="#c98b52"/>
  `)}</div>`;
}

function bowlingThumb(): string {
  let pins = "";
  const rows = [[160], [150, 170], [140, 160, 180], [130, 150, 170, 190]];
  rows.forEach((row, r) =>
    row.forEach((x) => {
      const y = 70 - r * 8;
      pins += `<ellipse cx="${x}" cy="${y + 12}" rx="6" ry="9" fill="#fff" stroke="#adb5bd" stroke-width=".6"/><rect x="${x - 6}" y="${y + 6}" width="12" height="2.4" fill="#e03131"/>`;
    }),
  );
  return `<div class="thumb-art">${svg(`
    <rect width="320" height="180" fill="#2b2f4a"/>
    <polygon points="118,40 202,40 300,180 20,180" fill="#4a4f6a"/>
    <polygon points="126,40 194,40 270,180 50,180" fill="#e9b872"/>
    <g stroke="#d49a52" stroke-width="1">${[0.2, 0.4, 0.6, 0.8].map((t) => `<line x1="${126 + 68 * t}" y1="40" x2="${50 + 220 * t}" y2="180"/>`).join("")}</g>
    <g fill="#c0392b">${[0.3, 0.42, 0.5, 0.58, 0.7].map((t) => `<polygon points="${50 + 220 * t},140 ${46 + 220 * t},150 ${54 + 220 * t},150"/>`).join("")}</g>
    ${pins}
    <circle cx="160" cy="160" r="13" fill="#3b5bdb"/><circle cx="156" cy="155" r="1.6" fill="#1c2b6b"/><circle cx="162" cy="154" r="1.6" fill="#1c2b6b"/>
  `)}</div>`;
}

function golfThumb(): string {
  return `<div class="thumb-art">${svg(`
    ${sky("#56a8ec", "#dff2fd")}
    <path d="M0 96 Q80 66 160 90 T320 82 V180 H0 Z" fill="#6fbf5a"/>
    <path d="M0 126 Q100 100 200 120 T320 116 V180 H0 Z" fill="#5aa847"/>
    <ellipse cx="200" cy="128" rx="58" ry="14" fill="#86d16e"/>
    <ellipse cx="208" cy="128" rx="3.4" ry="1.4" fill="#1d2b36"/>
    <line x1="208" y1="128" x2="208" y2="86" stroke="#f1f3f5" stroke-width="2"/>
    <polygon points="208,86 232,92 208,98" fill="#ff4d4d"/>
    <path d="M40 150 Q70 138 110 150 Q80 160 40 150 Z" fill="#f2d79b"/>
    <circle cx="120" cy="160" r="3.4" fill="#fff" stroke="#ced4da" stroke-width=".6"/>
  `)}</div>`;
}

function boxingThumb(): string {
  return `<div class="thumb-art">${svg(`
    <rect width="320" height="180" fill="#1f2340"/>
    <polygon points="140,0 180,0 230,120 90,120" fill="#ffffff" opacity=".08"/>
    ${crowd(18, 4, 0, 320)}
    <polygon points="40,96 280,96 310,170 10,170" fill="#e7ecf2"/>
    <polygon points="10,170 310,170 310,180 10,180" fill="#3b5bdb"/>
    <g stroke-width="2.4">
      <line x1="40" y1="66" x2="280" y2="66" stroke="#e03131"/><line x1="10" y1="140" x2="310" y2="140" stroke="#e03131"/>
      <line x1="40" y1="78" x2="280" y2="78" stroke="#fff"/><line x1="10" y1="153" x2="310" y2="153" stroke="#fff"/>
      <line x1="40" y1="88" x2="280" y2="88" stroke="#4dabf7"/><line x1="10" y1="164" x2="310" y2="164" stroke="#4dabf7"/>
    </g>
    <g fill="#ced4da"><rect x="37" y="60" width="6" height="38"/><rect x="277" y="60" width="6" height="38"/>
    <rect x="6" y="132" width="8" height="42"/><rect x="306" y="132" width="8" height="42"/></g>
    <circle cx="130" cy="116" r="11" fill="#e03131"/><circle cx="190" cy="112" r="11" fill="#1c7ed6"/>
  `)}</div>`;
}

/**
 * The sports on the home screen, in menu order. Tennis is the only game
 * (CLAUDE.md: no second game until the core is solid). The others are
 * "coming soon" placeholders: aria-disabled, they only change the preview,
 * can't be selected and never reach the server. Delete an entry to drop it.
 */
export const SPORTS: Sport[] = [
  { id: "tennis", name: "Tennis", playable: true, icon: ICONS.tennis, blurb: "Rally against the bot or a friend. Swing with your camera or the keyboard.", thumbnail: tennisThumb },
  { id: "baseball", name: "Baseball", playable: false, icon: ICONS.baseball, blurb: "Coming soon.", thumbnail: baseballThumb },
  { id: "bowling", name: "Bowling", playable: false, icon: ICONS.bowling, blurb: "Coming soon.", thumbnail: bowlingThumb },
  { id: "golf", name: "Golf", playable: false, icon: ICONS.golf, blurb: "Coming soon.", thumbnail: golfThumb },
  { id: "boxing", name: "Boxing", playable: false, icon: ICONS.boxing, blurb: "Coming soon.", thumbnail: boxingThumb },
];

// A chunky pointer arrow, drawn here (not a Nintendo asset), that marks the
// focused or hovered sport button.
const POINTER = `<svg class="pointer" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
  <path d="M6 3 L6 25 L11.5 20 L15.5 29 L20 27 L16 18.5 L24 18.5 Z" fill="#fff" stroke="#1769b8" stroke-width="2.4" stroke-linejoin="round"/>
</svg>`;

/** Only the selected sport (Tennis) has options; tennis keeps the actions it always had. */
const tennisOptions = `
  <button class="pill pill--primary" data-action="practice">Practice vs bot</button>
  <button class="pill" data-action="create">Create a room</button>
  <form class="join">
    <label for="code" hidden>Room code</label>
    <input id="code" name="code" placeholder="CODE" maxlength="4" autocomplete="off" aria-label="Room code" />
    <button class="pill pill--blue" type="submit">Join</button>
  </form>
`;

export function renderMenu(
  root: HTMLElement,
  name: string,
  matches: number,
  demo: 1 | 2 | null,
  error: string | null,
  actions: MenuActions,
): void {
  root.replaceChildren();
  const selected = SPORTS.find((s) => s.playable) ?? SPORTS[0];
  const menu = document.createElement("main");
  menu.className = "menu";
  menu.innerHTML = `
    <div class="menu-tab" aria-hidden="true">Main Menu</div>
    <div class="menu-column">
      <h1>Weblympics</h1>
      <figure class="thumb">
        <div class="thumb-frame" role="img" aria-label="${selected.name} preview"></div>
        <figcaption class="thumb-caption"><strong></strong> <span></span></figcaption>
      </figure>
      <div class="sports" role="group" aria-label="Sports">
        ${SPORTS.map(
          (s) => `
          <button class="pill sport" data-sport="${s.id}" type="button"
            ${s.playable ? `aria-pressed="${s === selected}"` : `aria-disabled="true"`}
            tabindex="${s === selected ? 0 : -1}">
            ${s.icon}<span class="sport-name">${s.name}</span>
            ${s.playable ? "" : `<span class="sport-soon">Coming soon</span>`}
            ${POINTER}
          </button>`,
        ).join("")}
      </div>
      <p class="error" role="alert" hidden></p>
      <section class="options" aria-labelledby="options-title">
        <h2 id="options-title">${selected.name}</h2>
        <div class="options-row">${tennisOptions}</div>
      </section>
      <footer class="menu-footer">
        <p class="who">${name ? `Playing as <strong></strong> · <span class="matches"></span>` : "Connecting…"}</p>
        ${
          name
            ? `<div class="identity-row" role="group" aria-label="Sign in">
                 ${demo !== 1 ? `<button class="pill pill--small" data-demo="1">Sign in as Demo One</button>` : ""}
                 ${demo !== 2 ? `<button class="pill pill--small" data-demo="2">Sign in as Demo Two</button>` : ""}
                 ${demo ? `<button class="pill pill--small" data-action="guest">Play as guest</button>` : ""}
               </div>`
            : ""
        }
        <p class="readme"><a href="/readme/">What makes this good?</a></p>
      </footer>
    </div>
  `;
  const strong = menu.querySelector<HTMLElement>(".who strong");
  if (strong) strong.textContent = name;
  const matchesEl = menu.querySelector<HTMLElement>(".matches");
  if (matchesEl) matchesEl.textContent = `${matches} match${matches === 1 ? "" : "es"} played`;
  const errorEl = menu.querySelector<HTMLElement>(".error");
  if (errorEl && error) {
    errorEl.textContent = error;
    errorEl.hidden = false;
  }

  // Preview: shows the focused or hovered sport, falling back to the selected one.
  const frame = menu.querySelector<HTMLElement>(".thumb-frame")!;
  const caption = menu.querySelector<HTMLElement>(".thumb-caption")!;
  const buttons = [...menu.querySelectorAll<HTMLButtonElement>(".sport")];
  let shown: Sport | null = null;
  const show = (sport: Sport) => {
    for (const b of buttons) b.classList.toggle("is-pointed", b.dataset.sport === sport.id);
    if (shown === sport) return;
    shown = sport;
    frame.innerHTML = sport.thumbnail();
    frame.setAttribute("aria-label", `${sport.name} preview${sport.playable ? "" : ", coming soon"}`);
    frame.classList.toggle("is-soon", !sport.playable);
    caption.querySelector("strong")!.textContent = sport.name;
    caption.querySelector("span")!.textContent = sport.blurb;
  };
  const sportOf = (b: HTMLElement) => SPORTS.find((s) => s.id === b.dataset.sport)!;
  const settle = () => {
    const active = buttons.find((b) => b === document.activeElement || b.matches(":hover"));
    show(active ? sportOf(active) : selected);
  };
  show(selected);
  // when focus leaves the group, Tab comes back to the selected sport, never
  // to a placeholder (placeholders take focus only to preview them)
  menu.querySelector(".sports")!.addEventListener("focusout", (event) => {
    const to = (event as FocusEvent).relatedTarget as Node | null;
    if (to && menu.querySelector(".sports")!.contains(to)) return;
    for (const b of buttons) b.tabIndex = b.getAttribute("aria-pressed") === "true" ? 0 : -1;
  });

  buttons.forEach((b, i) => {
    const sport = sportOf(b);
    b.addEventListener("focus", () => show(sport));
    b.addEventListener("mouseenter", () => show(sport));
    b.addEventListener("mouseleave", () => queueMicrotask(settle));
    b.addEventListener("blur", () => queueMicrotask(settle));
    b.addEventListener("click", () => {
      // placeholders are never selectable and never reach the server
      if (!sport.playable) return;
      for (const other of buttons) if (other.hasAttribute("aria-pressed")) other.setAttribute("aria-pressed", String(other === b));
      // opening a sport takes you to its options (practice / create / join)
      const options = menu.querySelector<HTMLElement>(".options")!;
      options.classList.remove("is-opened");
      void options.offsetWidth;
      options.classList.add("is-opened");
      menu.querySelector<HTMLElement>(".options button")?.focus();
    });
    b.addEventListener("keydown", (event) => {
      const step: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      let next: number | null = null;
      if (event.key in step) next = (i + step[event.key] + buttons.length) % buttons.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = buttons.length - 1;
      if (next === null) return;
      event.preventDefault();
      // roving tabindex: the group is one Tab stop, arrows move inside it
      for (const other of buttons) other.tabIndex = -1;
      buttons[next].tabIndex = 0;
      buttons[next].focus();
    });
  });

  menu.querySelector("[data-action=practice]")?.addEventListener("click", actions.onPractice);
  menu.querySelector("[data-action=create]")?.addEventListener("click", actions.onCreate);
  menu.querySelector("[data-action=guest]")?.addEventListener("click", actions.onPlayAsGuest);
  menu.querySelectorAll<HTMLButtonElement>("[data-demo]").forEach((b) => {
    b.addEventListener("click", () => actions.onSignInDemo(Number(b.dataset.demo) as 1 | 2));
  });
  menu.querySelector("form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const code = new FormData(event.currentTarget as HTMLFormElement).get("code");
    if (typeof code === "string" && code.trim()) actions.onJoin(code.trim().toUpperCase());
  });
  root.append(menu);
}
