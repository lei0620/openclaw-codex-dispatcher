import { describe, expect, it } from "vitest";
import { deriveDesktopActivityTasks } from "../public/conversationAttention.js";

describe("deriveDesktopActivityTasks", () => {
  it("turns a running desktop conversation into an active card task", () => {
    const tasks = deriveDesktopActivityTasks([
      {
        id: "conversation-a",
        projectId: "project-a",
        title: "桌面任务",
        activityStatus: "running",
        activityUpdatedAt: "2026-07-16T15:00:00.000Z"
      }
    ]);

    expect(tasks).toMatchObject([{
      conversationId: "conversation-a",
      projectId: "project-a",
      prompt: "桌面任务",
      source: "desktop",
      status: "running"
    }]);
  });

  it("does not duplicate a running NAS task for the same conversation", () => {
    const tasks = deriveDesktopActivityTasks(
      [{
        id: "conversation-a",
        projectId: "project-a",
        activityStatus: "running",
        activityUpdatedAt: "2026-07-16T15:00:00.000Z"
      }],
      [{ conversationId: "conversation-a", status: "running" }]
    );

    expect(tasks).toEqual([]);
  });

  it("turns a completed desktop conversation into a stable unread candidate", () => {
    const tasks = deriveDesktopActivityTasks([
      {
        id: "conversation-a",
        projectId: "project-a",
        title: "完成的任务",
        activityStatus: "completed",
        activityUpdatedAt: "2026-07-16T15:05:00.000Z"
      }
    ]);

    expect(tasks[0]).toMatchObject({
      id: "desktop:conversation-a:completed:2026-07-16T15:05:00.000Z",
      status: "completed",
      finishedAt: "2026-07-16T15:05:00.000Z"
    });
  });
});
