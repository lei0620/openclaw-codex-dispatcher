import { describe, expect, it } from "vitest";
import { isCodexContextMessage, selectRecentConversationMessages } from "../src/agent/codexSessions.js";
import { stripInternalMarkup } from "../src/shared/textSanitizer.js";
import type { ConversationMessage } from "../src/shared/types.js";

describe("selectRecentConversationMessages", () => {
  it("keeps the latest user turn even when many assistant progress messages follow", () => {
    const messages: ConversationMessage[] = [
      { role: "user", text: "旧问题", at: "2026-05-31T10:00:00.000Z" },
      { role: "assistant", text: "旧回答", at: "2026-05-31T10:01:00.000Z" },
      { role: "user", text: "手机同步这个问题", at: "2026-05-31T10:02:00.000Z" },
      ...Array.from({ length: 24 }, (_, index) => ({
        role: "assistant" as const,
        text: `处理中 ${index + 1}`,
        at: `2026-05-31T10:${String(index + 3).padStart(2, "0")}:00.000Z`
      }))
    ];

    const selected = selectRecentConversationMessages(messages);

    expect(selected[0]).toMatchObject({ role: "user", text: "手机同步这个问题" });
    expect(selected).toHaveLength(18);
    expect(selected.at(-1)).toMatchObject({ text: "处理中 24" });
  });

  it("keeps the latest three user turns when the conversation is short", () => {
    const messages: ConversationMessage[] = [
      { role: "user", text: "第一轮", at: "2026-05-31T10:00:00.000Z" },
      { role: "assistant", text: "回答一", at: "2026-05-31T10:01:00.000Z" },
      { role: "user", text: "第二轮", at: "2026-05-31T10:02:00.000Z" },
      { role: "assistant", text: "回答二", at: "2026-05-31T10:03:00.000Z" },
      { role: "user", text: "第三轮", at: "2026-05-31T10:04:00.000Z" },
      { role: "assistant", text: "回答三", at: "2026-05-31T10:05:00.000Z" },
      { role: "user", text: "第四轮", at: "2026-05-31T10:06:00.000Z" }
    ];

    expect(selectRecentConversationMessages(messages).map((message) => message.text)).toEqual([
      "第二轮",
      "回答二",
      "第三轮",
      "回答三",
      "第四轮"
    ]);
  });

  it("normalizes newest-first synced messages back to chat order", () => {
    const selected = selectRecentConversationMessages([
      { role: "user", text: "在吗", at: "2026-06-01T14:24:00.000Z" },
      { role: "assistant", text: "在。", at: "2026-06-01T14:24:10.000Z" },
      { role: "user", text: "我成功了", at: "2026-06-01T14:10:00.000Z" },
      { role: "assistant", text: "好的。", at: "2026-06-01T14:10:10.000Z" }
    ]);

    expect(selected.map((message) => message.text)).toEqual(["我成功了", "好的。", "在吗", "在。"]);
  });

  it("filters internal continuation context messages", () => {
    expect(isCodexContextMessage("<goal_context>\nContinue working toward the active thread goal.")).toBe(true);
  });

  it("removes internal memory citation markup from display text", () => {
    expect(
      stripInternalMarkup(`收到了，这次是实时进来的。\n\n<oai-mem-citation>\n<citation_entries>\nMEMORY.md:1-3|note=[x]\n</citation_entries>\n</oai-mem-citation>`)
    ).toBe("收到了，这次是实时进来的。");
  });
});
