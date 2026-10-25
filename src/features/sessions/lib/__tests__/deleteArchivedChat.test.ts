import { QueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "@/features/chat/stores/chatStore";
import { INITIAL_SESSION_CHAT_RUNTIME } from "@/shared/types/chat";
import { deleteArchivedChat } from "../deleteArchivedChat";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  deleteArchivedSession: vi.fn(),
  removeChatPins: vi.fn(),
  unregister: vi.fn(),
  clearMessage: vi.fn(),
}));
vi.mock("@/features/chat/stores/chatSessionStore", () => ({
  SessionDeletionUnavailableError: class extends Error {},
  useChatSessionStore: {
    getState: () => ({
      getSession: mocks.getSession,
      deleteArchivedSession: mocks.deleteArchivedSession,
    }),
  },
}));
vi.mock("@/features/home/stores/homeWidgetStore", () => ({
  useHomeWidgetStore: {
    getState: () => ({ removeChatPins: mocks.removeChatPins }),
  },
}));
vi.mock("@/shared/api/acpSessionBackends", () => ({
  unregisterSessionBackend: mocks.unregister,
}));
vi.mock("@/shared/api/acpActiveMessageTracking", () => ({
  clearActiveMessageId: mocks.clearMessage,
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.getSession.mockReturnValue({
    id: "delete-me",
    archivedAt: "2026-10-01",
  });
  mocks.deleteArchivedSession.mockResolvedValue({ cleanupFailed: false });
  mocks.removeChatPins.mockResolvedValue(undefined);
  vi.mocked(invoke).mockResolvedValue(undefined);
  useChatStore.setState({
    sessionStateById: {},
    messagesBySession: {},
    draftsBySession: {},
    activeSessionId: null,
    loadingSessionIds: new Set(),
  });
});

describe("deleteArchivedChat", () => {
  it("does not discard local data if canonical deletion fails", async () => {
    const client = new QueryClient();
    mocks.deleteArchivedSession.mockRejectedValueOnce(new Error("offline"));
    useChatStore.setState({
      draftsBySession: { "delete-me": "private draft" },
    });
    client.setQueryData(
      ["session-search-corpus", "delete-me", "v1"],
      "private transcript",
    );
    await expect(deleteArchivedChat("delete-me", client)).rejects.toThrow(
      "offline",
    );
    expect(useChatStore.getState().draftsBySession["delete-me"]).toBe(
      "private draft",
    );
    expect(
      client.getQueryData(["session-search-corpus", "delete-me", "v1"]),
    ).toBe("private transcript");
    expect(mocks.removeChatPins).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith(
      "forget_session_search_cache",
      expect.anything(),
    );
    client.clear();
  });

  it("rejects running or non-archived chats before calling the backend", async () => {
    const client = new QueryClient();
    mocks.getSession.mockReturnValueOnce({ id: "delete-me" });
    await expect(deleteArchivedChat("delete-me", client)).rejects.toThrow();
    useChatStore.setState({
      sessionStateById: {
        "delete-me": {
          ...INITIAL_SESSION_CHAT_RUNTIME,
          chatState: "streaming",
          tokenState: { ...INITIAL_SESSION_CHAT_RUNTIME.tokenState },
        },
      },
    });
    await expect(deleteArchivedChat("delete-me", client)).rejects.toThrow();
    expect(mocks.deleteArchivedSession).not.toHaveBeenCalled();
    client.clear();
  });

  it("cleans memory, every search version, pins and the native projection after backend success", async () => {
    const client = new QueryClient();
    useChatStore.setState({
      draftsBySession: { "delete-me": "private draft", kept: "other draft" },
    });
    client.setQueryData(
      ["session-search-corpus", "delete-me", "v1"],
      "private transcript",
    );
    client.setQueryData(
      ["session-search-corpus", "delete-me", "v2"],
      "later transcript",
    );
    client.setQueryData(
      ["session-search-corpus", "kept", "v1"],
      "kept transcript",
    );
    await expect(deleteArchivedChat("delete-me", client)).resolves.toEqual({
      cleanupFailed: false,
    });
    expect(useChatStore.getState().draftsBySession).toEqual({
      kept: "other draft",
    });
    expect(
      client.getQueriesData({
        queryKey: ["session-search-corpus", "delete-me"],
      }),
    ).toEqual([]);
    expect(client.getQueryData(["session-search-corpus", "kept", "v1"])).toBe(
      "kept transcript",
    );
    expect(mocks.removeChatPins).toHaveBeenCalledWith("delete-me");
    expect(invoke).toHaveBeenCalledWith("forget_session_search_cache", {
      sessionId: "delete-me",
    });
    expect(mocks.unregister).toHaveBeenCalledWith("delete-me");
    client.clear();
  });

  it("reports post-delete cache failure separately and continues the other cleanup", async () => {
    const client = new QueryClient();
    vi.mocked(invoke).mockRejectedValueOnce(new Error("cache locked"));
    await expect(deleteArchivedChat("delete-me", client)).resolves.toEqual({
      cleanupFailed: true,
    });
    expect(mocks.removeChatPins).toHaveBeenCalledWith("delete-me");
    expect(mocks.unregister).toHaveBeenCalledWith("delete-me");
    client.clear();
  });

  it("does not purge the local native database for a remote session", async () => {
    const client = new QueryClient();
    mocks.getSession.mockReturnValue({
      id: "delete-me",
      archivedAt: "2026-10-01",
      remoteHost: "example",
    });
    await deleteArchivedChat("delete-me", client);
    expect(invoke).not.toHaveBeenCalledWith(
      "forget_session_search_cache",
      expect.anything(),
    );
    client.clear();
  });
});
