import type { ConversationMessage } from "../src/shared/types.js";

export type ConversationPresentationItem =
  | { type: "message"; message: ConversationMessage; process: ConversationMessage[] }
  | { type: "process"; process: ConversationMessage[] };

export declare function groupConversationMessages(messages: ConversationMessage[]): ConversationPresentationItem[];
