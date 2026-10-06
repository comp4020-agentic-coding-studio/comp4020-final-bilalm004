export interface MenuActions {
  onPractice(): void;
  onCreate(): void;
  onJoin(code: string): void;
  onSignInDemo(n: 1 | 2): void;
  onPlayAsGuest(): void;
}

// Two decorative Mii-style figures that take turns crossing the court behind
// the card: a runner, then (later in the same loop) a server who stops to
// toss, swing and send the ball off before running on. Pure CSS/DOM, so the
// menu never pulls in Three.js (that stays lazy, loaded only once a game
// starts). Purely decorative: aria-hidden, and spec/privacy.test.ts doesn't
// apply here since nothing is fetched.
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

export function renderMenu(
  root: HTMLElement,
  name: string,
  matches: number,
  demo: 1 | 2 | null,
  error: string | null,
  actions: MenuActions,
): void {
  root.replaceChildren();
  const menu = document.createElement("main");
  menu.className = "menu";
  menu.innerHTML = `
    <div class="menu-scene" aria-hidden="true">
      <div class="menu-court"></div>
      ${sprite("runner")}
      ${sprite("server")}
    </div>
    <div class="menu-card">
      <h1>Weblympics</h1>
      <p class="muted">${name ? `Playing as <strong></strong> · <span class="matches"></span>` : "Connecting…"}</p>
      ${
        name
          ? `<div class="identity-row" role="group" aria-label="Sign in">
               ${demo !== 1 ? `<button data-demo="1">Sign in as Demo One</button>` : ""}
               ${demo !== 2 ? `<button data-demo="2">Sign in as Demo Two</button>` : ""}
               ${demo ? `<button data-action="guest">Play as guest</button>` : ""}
             </div>`
          : ""
      }
      <p class="error" role="alert" hidden></p>
      <button class="primary" data-action="practice">Practice vs bot</button>
      <button data-action="create">Create a room</button>
      <form>
        <label class="muted" for="code" hidden>Room code</label>
        <input id="code" name="code" placeholder="CODE" maxlength="4" autocomplete="off" aria-label="Room code" />
        <button type="submit">Join</button>
      </form>
      <p class="muted"><a href="/readme/">What makes this good?</a></p>
    </div>
  `;
  const strong = menu.querySelector("strong");
  if (strong) strong.textContent = name;
  const matchesEl = menu.querySelector<HTMLElement>(".matches");
  if (matchesEl) matchesEl.textContent = `${matches} match${matches === 1 ? "" : "es"} played`;
  const errorEl = menu.querySelector<HTMLElement>(".error");
  if (errorEl && error) {
    errorEl.textContent = error;
    errorEl.hidden = false;
  }
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
