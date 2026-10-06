export interface MenuActions {
  onPractice(): void;
  onCreate(): void;
  onJoin(code: string): void;
}

export function renderMenu(root: HTMLElement, name: string, error: string | null, actions: MenuActions): void {
  root.replaceChildren();
  const menu = document.createElement("main");
  menu.className = "menu";
  menu.innerHTML = `
    <h1>Webcam Tennis</h1>
    <p class="muted">${name ? `Playing as <strong></strong>` : "Connecting…"}</p>
    <p class="error" role="alert" hidden></p>
    <button class="primary" data-action="practice">Practice vs bot</button>
    <button data-action="create">Create a room</button>
    <form>
      <label class="muted" for="code" hidden>Room code</label>
      <input id="code" name="code" placeholder="CODE" maxlength="4" autocomplete="off" aria-label="Room code" />
      <button type="submit">Join</button>
    </form>
    <p class="muted"><a href="/readme/">What makes this good?</a></p>
  `;
  const strong = menu.querySelector("strong");
  if (strong) strong.textContent = name;
  const errorEl = menu.querySelector<HTMLElement>(".error");
  if (errorEl && error) {
    errorEl.textContent = error;
    errorEl.hidden = false;
  }
  menu.querySelector("[data-action=practice]")?.addEventListener("click", actions.onPractice);
  menu.querySelector("[data-action=create]")?.addEventListener("click", actions.onCreate);
  menu.querySelector("form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const code = new FormData(event.currentTarget as HTMLFormElement).get("code");
    if (typeof code === "string" && code.trim()) actions.onJoin(code.trim().toUpperCase());
  });
  root.append(menu);
}
