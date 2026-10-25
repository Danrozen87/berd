import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgetPersistedDraft, persistDrafts } from "./draftPersistence";
import {
  forgetPersistedUnreadSession,
  persistUnreadSessionIds,
} from "./unreadPersistence";
import {
  forgetPersistedAutoMode,
  persistAutoMode,
} from "./autoModePersistence";
import {
  forgetPersistedWorkspaceMetadata,
  removePersistedChatWorkspaceMetadata,
} from "./workspaceAttachmentPersistence";
import {
  forgetPersistedRemoteSession,
  removeRemoteSessionRecord,
} from "./remoteSessionPersistence";

const workspace = {
  workspaceAttachments: [
    {
      id: "workspace",
      path: "/repo",
      kind: "directory",
      source: "selected",
      branch: null,
      usedByAgent: false,
    },
  ],
  activeWorkspaceId: "workspace",
  workingDir: "/repo",
};
const remote = {
  host: "devbox",
  title: "Archived chat",
  workingDir: "/repo",
  updatedAt: "2026-10-25T12:00:00.000Z",
};
const cases = [
  {
    name: "draft",
    key: "goose:chat-drafts",
    initial: { deleted: "unsent private text", retained: "keep this draft" },
    remaining: { retained: "keep this draft" },
    onlyDeleted: { deleted: "unsent private text" },
    forget: forgetPersistedDraft,
    bestEffort: () => persistDrafts({ retained: "keep this draft" }),
  },
  {
    name: "unread marker",
    key: "goose:unread-sessions",
    initial: ["deleted", "retained"],
    remaining: ["retained"],
    onlyDeleted: ["deleted"],
    forget: forgetPersistedUnreadSession,
    bestEffort: () => persistUnreadSessionIds(["retained"]),
  },
  {
    name: "auto mode",
    key: "goose:chat-auto-modes",
    initial: { deleted: "work", retained: null },
    remaining: { retained: null },
    onlyDeleted: { deleted: "work" },
    forget: forgetPersistedAutoMode,
    bestEffort: () => persistAutoMode("deleted", undefined),
  },
  {
    name: "workspace metadata",
    key: "goose:chat-workspace-metadata",
    initial: { deleted: workspace, retained: workspace },
    remaining: { retained: workspace },
    onlyDeleted: { deleted: workspace },
    forget: forgetPersistedWorkspaceMetadata,
    bestEffort: () => removePersistedChatWorkspaceMetadata("deleted"),
  },
  {
    name: "remote identity",
    key: "goose:remote-sessions:v1",
    initial: {
      deleted: { ...remote, sessionId: "deleted" },
      retained: { ...remote, sessionId: "retained" },
    },
    remaining: { retained: { ...remote, sessionId: "retained" } },
    onlyDeleted: { deleted: { ...remote, sessionId: "deleted" } },
    forget: forgetPersistedRemoteSession,
    bestEffort: () => removeRemoteSessionRecord("deleted"),
  },
];

describe.each(cases)("acknowledged $name removal", (entry) => {
  beforeEach(() => window.localStorage.clear());

  it("removes only the deleted session and permits repeated cleanup", () => {
    window.localStorage.setItem(entry.key, JSON.stringify(entry.initial));
    entry.forget("deleted");
    entry.forget("deleted");
    expect(
      JSON.parse(window.localStorage.getItem(entry.key) ?? "null"),
    ).toEqual(entry.remaining);
  });

  it("removes the storage key when no sessions remain", () => {
    window.localStorage.setItem(entry.key, JSON.stringify(entry.onlyDeleted));
    entry.forget("deleted");
    expect(window.localStorage.getItem(entry.key)).toBeNull();
  });

  it("reports failed reads without overwriting retained sessions", () => {
    const stored = JSON.stringify(entry.initial);
    window.localStorage.setItem(entry.key, stored);
    const error = new Error("storage read denied");
    const read = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw error;
      });
    expect(() => entry.forget("deleted")).toThrow(error);
    read.mockRestore();
    expect(window.localStorage.getItem(entry.key)).toBe(stored);
  });

  it.each([
    "setItem",
    "removeItem",
  ] as const)("reports failed %s writes", (method) => {
    const stored = JSON.stringify(
      method === "removeItem" ? entry.onlyDeleted : entry.initial,
    );
    window.localStorage.setItem(entry.key, stored);
    const error = new Error("storage write denied");
    const write = vi.spyOn(Storage.prototype, method).mockImplementation(() => {
      throw error;
    });
    expect(() => entry.forget("deleted")).toThrow(error);
    write.mockRestore();
    expect(window.localStorage.getItem(entry.key)).toBe(stored);
  });

  it("preserves best-effort behavior for ordinary writers", () => {
    window.localStorage.setItem(entry.key, JSON.stringify(entry.initial));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(entry.bestEffort).not.toThrow();
  });
});
