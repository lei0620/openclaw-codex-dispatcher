import { describe, expect, it } from "vitest";
import { groupConversationMessages } from "../public/conversationPresentation.js";

describe("groupConversationMessages", () => {
  it("folds commentary into the final answer for one Codex turn", () => {
    const grouped = groupConversationMessages([
      { role: "user", text: "检查项目", at: "2026-07-11T10:00:00.000Z" },
      { role: "assistant", phase: "commentary", text: "正在读取文件", at: "2026-07-11T10:00:01.000Z" },
      { role: "assistant", phase: "commentary", text: "正在运行测试", at: "2026-07-11T10:00:02.000Z" },
      { role: "assistant", phase: "final_answer", text: "检查完成，测试通过。", at: "2026-07-11T10:00:03.000Z" }
    ]);

    expect(grouped).toEqual([
      { type: "message", message: expect.objectContaining({ role: "user", text: "检查项目" }), process: [] },
      {
        type: "message",
        message: expect.objectContaining({ phase: "final_answer", text: "检查完成，测试通过。" }),
        process: [
          expect.objectContaining({ text: "正在读取文件" }),
          expect.objectContaining({ text: "正在运行测试" })
        ]
      }
    ]);
  });

  it("keeps an unfinished commentary group as an in-progress item", () => {
    expect(groupConversationMessages([
      { role: "user", text: "继续", at: "2026-07-11T10:00:00.000Z" },
      { role: "assistant", phase: "commentary", text: "正在处理", at: "2026-07-11T10:00:01.000Z" }
    ])).toEqual([
      { type: "message", message: expect.objectContaining({ role: "user" }), process: [] },
      { type: "process", process: [expect.objectContaining({ text: "正在处理" })] }
    ]);
  });

  it("treats legacy assistant messages without a phase as final answers", () => {
    expect(groupConversationMessages([
      { role: "assistant", text: "旧版回答", at: "2026-07-11T10:00:00.000Z" }
    ])).toEqual([
      { type: "message", message: expect.objectContaining({ text: "旧版回答" }), process: [] }
    ]);
  });
});
