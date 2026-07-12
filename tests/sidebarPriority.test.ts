import { describe, expect, it } from "vitest";
import { deriveAttentionConversations, deriveRecentProjects, deriveRunningConversations } from "../public/sidebarPriority.js";

const projects = [
  { id: "project-a", name: "项目 A" },
  { id: "project-b", name: "项目 B" },
  { id: "project-c", name: "项目 C" },
  { id: "project-d", name: "项目 D" }
];

describe("deriveRecentProjects", () => {
  it("returns the newest conversation for up to three unique existing projects", () => {
    const conversations = [
      conversation("a-old", "project-a", "2026-07-11T08:00:00.000Z"),
      conversation("b-new", "project-b", "2026-07-11T12:00:00.000Z"),
      conversation("a-new", "project-a", "2026-07-11T11:00:00.000Z"),
      conversation("missing", "removed-project", "2026-07-11T13:00:00.000Z"),
      conversation("c-new", "project-c", "2026-07-11T10:00:00.000Z"),
      conversation("d-old", "project-d", "2026-07-11T09:00:00.000Z")
    ];

    const result = deriveRecentProjects(projects, conversations);

    expect(result.map((item) => [item.project.id, item.conversation.id])).toEqual([
      ["project-b", "b-new"],
      ["project-a", "a-new"],
      ["project-c", "c-new"]
    ]);
    expect(conversations.map((item) => item.id)).toEqual(["a-old", "b-new", "a-new", "missing", "c-new", "d-old"]);
  });

  it("supports a smaller non-negative limit", () => {
    const conversations = [
      conversation("a", "project-a", "2026-07-11T10:00:00.000Z"),
      conversation("b", "project-b", "2026-07-11T09:00:00.000Z")
    ];

    expect(deriveRecentProjects(projects, conversations, 1)).toHaveLength(1);
    expect(deriveRecentProjects(projects, conversations, -1)).toEqual([]);
  });
});

describe("deriveRunningConversations", () => {
  it("keeps task order and associates each task with its project and conversation", () => {
    const conversations = [
      conversation("conversation-a", "project-a", "2026-07-11T10:00:00.000Z"),
      conversation("conversation-b", "project-b", "2026-07-11T11:00:00.000Z")
    ];
    const tasks = [
      { id: "task-b", projectId: "project-b", conversationId: "conversation-b", status: "running" },
      { id: "task-a", projectId: "project-a", conversationId: "conversation-a", status: "queued" }
    ];

    const result = deriveRunningConversations(projects, conversations, tasks);

    expect(result.map((item) => [item.task.id, item.project?.id, item.conversation?.id])).toEqual([
      ["task-b", "project-b", "conversation-b"],
      ["task-a", "project-a", "conversation-a"]
    ]);
  });

  it("keeps a running task visible while its conversation is still syncing", () => {
    const tasks = [{ id: "task-new", projectId: "project-a", conversationId: "conversation-new", status: "running" }];

    const result = deriveRunningConversations(projects, [], tasks);

    expect(result).toHaveLength(1);
    expect(result[0].project?.id).toBe("project-a");
    expect(result[0].conversation).toBeUndefined();
  });
});

describe("deriveAttentionConversations", () => {
  it("keeps active conversations first and appends unread terminal results", () => {
    const conversations = [
      conversation("conversation-a", "project-a", "2026-07-11T10:00:00.000Z"),
      conversation("conversation-b", "project-b", "2026-07-11T11:00:00.000Z"),
      conversation("conversation-c", "project-c", "2026-07-11T12:00:00.000Z")
    ];
    const activeTasks = [
      { id: "running-a", projectId: "project-a", conversationId: "conversation-a", status: "running" },
      { id: "running-b", projectId: "project-b", conversationId: "conversation-b", status: "queued" }
    ];
    const unreadTasks = [
      { id: "done-b", projectId: "project-b", conversationId: "conversation-b", status: "completed" },
      { id: "failed-c", projectId: "project-c", conversationId: "conversation-c", status: "failed" }
    ];

    const result = deriveAttentionConversations(projects, conversations, activeTasks, unreadTasks);

    expect(result.map((item) => [item.task.id, item.unread])).toEqual([
      ["running-a", false],
      ["running-b", false],
      ["failed-c", true]
    ]);
  });

  it("shows only the newest unread result for each conversation", () => {
    const conversations = [conversation("conversation-a", "project-a", "2026-07-11T10:00:00.000Z")];
    const unreadTasks = [
      { id: "new", projectId: "project-a", conversationId: "conversation-a", status: "failed", finishedAt: "2026-07-12T10:02:00.000Z" },
      { id: "old", projectId: "project-a", conversationId: "conversation-a", status: "completed", finishedAt: "2026-07-12T10:01:00.000Z" }
    ];

    const result = deriveAttentionConversations(projects, conversations, [], unreadTasks);

    expect(result.map((item) => item.task.id)).toEqual(["new"]);
    expect(result[0].unread).toBe(true);
  });
});

function conversation(id: string, projectId: string, updatedAt: string) {
  return { id, projectId, updatedAt, title: id };
}
