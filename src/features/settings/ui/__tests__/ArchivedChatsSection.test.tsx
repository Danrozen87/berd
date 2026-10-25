import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { useChatSessionStore } from "@/features/chat/stores/chatSessionStore";
import { deleteArchivedChat } from "@/features/sessions/lib/deleteArchivedChat";
import { ArchivedChatsSection } from "../ArchivedChatsSection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { title?: string }) =>
      options?.title ? `${key} ${options.title}` : key,
  }),
}));
vi.mock("@/shared/i18n", () => ({
  useLocaleFormatting: () => ({ formatRelativeTimeToNow: () => "yesterday" }),
}));
vi.mock("@/shared/api/acpApi", () => ({
  unarchiveSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/features/sessions/lib/deleteArchivedChat", () => ({
  deleteArchivedChat: vi.fn(),
}));
vi.mock("@/features/projects/api/projects", () => ({
  listProjects: vi.fn().mockResolvedValue([]),
  listArchivedProjects: vi.fn().mockResolvedValue([]),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

function setup() {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <ArchivedChatsSection />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  useChatSessionStore.setState({
    sessions: [
      {
        id: "archived-ui",
        title: "Private chat",
        createdAt: "2026-10-01",
        updatedAt: "2026-10-01",
        archivedAt: "2026-10-02",
        messageCount: 2,
      },
    ],
    activeSessionId: null,
  });
  vi.mocked(deleteArchivedChat).mockResolvedValue({ cleanupFailed: false });
});

describe("ArchivedChatsSection deletion", () => {
  it("names the chat and permits cancellation without deleting", async () => {
    const user = setup();
    await user.click(
      screen.getByRole("button", { name: "chats.deleteLabel Private chat" }),
    );
    expect(
      screen.getByRole("dialog", { name: "chats.deleteTitle Private chat" }),
    ).toBeInTheDocument();
    expect(screen.getByText("chats.deleteDescription")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "common:actions.cancel" }),
    );
    expect(deleteArchivedChat).not.toHaveBeenCalled();
    expect(screen.getByText("Private chat")).toBeInTheDocument();
  });

  it("blocks duplicate actions and dismissals until confirmed deletion completes", async () => {
    let finish!: (result: { cleanupFailed: boolean }) => void;
    vi.mocked(deleteArchivedChat).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = setup();
    await user.click(
      screen.getByRole("button", { name: "chats.deleteLabel Private chat" }),
    );
    await user.click(
      screen.getByRole("button", { name: "chats.deleteConfirm" }),
    );
    expect(
      screen.getByRole("button", { name: "chats.deleting" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "common:actions.cancel" }),
    ).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(deleteArchivedChat).toHaveBeenCalledTimes(1);
    await act(async () => {
      useChatSessionStore.getState().removeSession("archived-ui");
      finish({ cleanupFailed: false });
    });
    await waitFor(() =>
      expect(screen.queryByText("Private chat")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("chats.empty")).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("chats.deleteSuccess");
  });

  it("keeps the record and confirmation after failure so deletion can be retried", async () => {
    vi.mocked(deleteArchivedChat).mockRejectedValueOnce(new Error("offline"));
    const user = setup();
    await user.click(
      screen.getByRole("button", { name: "chats.deleteLabel Private chat" }),
    );
    await user.click(
      screen.getByRole("button", { name: "chats.deleteConfirm" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("chats.deleteError"),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "chats.deleteConfirm" }),
    ).toBeEnabled();
    expect(
      useChatSessionStore.getState().getSession("archived-ui"),
    ).toBeDefined();
  });
});
