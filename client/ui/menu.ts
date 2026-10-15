export interface MenuActions {
  /** Training (task 5): runs in the page against a ball machine, no server. */
  onTrain(): void;
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
  archery: icon(
    `<circle cx="12" cy="12" r="10" fill="#fff" stroke="#9aa5b1" stroke-width="1.2"/><circle cx="12" cy="12" r="7" fill="#4dabf7"/><circle cx="12" cy="12" r="4.4" fill="#e03131"/><circle cx="12" cy="12" r="1.8" fill="#ffd23f"/>`,
  ),
  bowling: icon(
    `<path d="M12 2c2 0 2.6 2 2 4.5-.4 1.6 3 5 3 9.5 0 3.5-2 6-5 6s-5-2.5-5-6c0-4.5 3.4-7.9 3-9.5C9.4 4 10 2 12 2z" fill="#fff" stroke="#9aa5b1" stroke-width="1.2"/><path d="M9.6 7.6h4.8" stroke="#e03131" stroke-width="1.6"/>`,
  ),
  mystery: icon(
    `<circle cx="12" cy="12" r="10" fill="#e7ecf2" stroke="#9aa5b1" stroke-width="1.2"/><text x="12" y="16.5" text-anchor="middle" font-size="12" font-weight="800" font-family="system-ui, sans-serif" fill="#6b7a8a">?</text>`,
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

function archeryThumb(): string {
  return `<div class="thumb-art">${svg(`
    ${sky("#5fb0ee", "#d6eefc")}
    <path d="M0 104 Q90 84 180 100 T320 96 V180 H0 Z" fill="#6fbf5a"/>
    <rect y="120" width="320" height="60" fill="#4f9e3d"/>
    <line x1="150" y1="118" x2="140" y2="156" stroke="#8d6e4f" stroke-width="3"/><line x1="190" y1="118" x2="200" y2="156" stroke="#8d6e4f" stroke-width="3"/>
    <circle cx="170" cy="92" r="40" fill="#fff" stroke="#adb5bd" stroke-width="1.4"/>
    <circle cx="170" cy="92" r="32" fill="#2b2f4a"/><circle cx="170" cy="92" r="24" fill="#4dabf7"/>
    <circle cx="170" cy="92" r="16" fill="#e03131"/><circle cx="170" cy="92" r="7" fill="#ffd23f"/>
    <g stroke="#6b4f33" stroke-width="2.4" stroke-linecap="round"><line x1="176" y1="86" x2="246" y2="36"/><line x1="160" y1="98" x2="100" y2="140"/></g>
    <g fill="#e03131"><polygon points="246,36 236,38 242,46"/></g>
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

function mysteryThumb(): string {
  return `<div class="thumb-art">${svg(`
    <rect width="320" height="180" fill="#c9dcf0"/>
    <rect width="320" height="180" fill="#ffffff" opacity=".25"/>
    <text x="160" y="124" text-anchor="middle" font-size="110" font-weight="800" font-family="system-ui, sans-serif" fill="#7d93ab">??</text>
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
  { id: "bowling", name: "Bowling", playable: false, icon: ICONS.bowling, blurb: "Coming soon.", thumbnail: bowlingThumb },
  { id: "archery", name: "Archery", playable: false, icon: ICONS.archery, blurb: "Coming soon.", thumbnail: archeryThumb },
  { id: "mystery-1", name: "??", playable: false, icon: ICONS.mystery, blurb: "A secret sport. Who knows?", thumbnail: mysteryThumb },
  { id: "mystery-2", name: "??", playable: false, icon: ICONS.mystery, blurb: "A secret sport. Who knows?", thumbnail: mysteryThumb },
];

// A chunky pointer arrow, drawn here (not a Nintendo asset), that marks the
// focused or hovered sport button.
const POINTER = `<svg class="pointer" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
  <path d="M6 3 L6 25 L11.5 20 L15.5 29 L20 27 L16 18.5 L24 18.5 Z" fill="#fff" stroke="#1769b8" stroke-width="2.4" stroke-linejoin="round"/>
</svg>`;

/** Only the selected sport (Tennis) has options; tennis keeps the actions it always had. */
const tennisOptions = `
  <button class="pill pill--primary" data-action="practice">Practice vs bot</button>
  <button class="pill" data-action="train">Train</button>
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
            ${s.playable || s.name === "??" ? "" : `<span class="sport-soon">Coming soon</span>`}
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
  menu.querySelector("[data-action=train]")?.addEventListener("click", actions.onTrain);
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
