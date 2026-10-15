import type { ClientMsg, ServerMsg } from "../../shared/protocol.ts";

/**
 * What a game view needs from the network: messages in, messages out.
 * `Connection` (the server) and training's `LocalLink` (a sim in the page,
 * no network) both are one, so the same view renders either.
 */
export interface GameLink {
  on(handler: (msg: ServerMsg) => void): () => void;
  send(msg: ClientMsg): void;
}
