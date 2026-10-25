import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  SessionDeletionUnavailableError,
  useChatSessionStore,
} from "@/features/chat/stores/chatSessionStore";
import { deleteArchivedChat } from "@/features/sessions/lib/deleteArchivedChat";

type ArchivedChatAction = "restore" | "delete";

function errorMessageKey(error: unknown, action: ArchivedChatAction) {
  if (error instanceof SessionDeletionUnavailableError)
    return "chats.deleteUnavailable";
  return action === "restore" ? "chats.restoreError" : "chats.deleteError";
}

export function useArchivedChatActions(sessionId: string) {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<ArchivedChatAction | null>(null);
  const busy = useRef(false);

  const perform = async (action: ArchivedChatAction) => {
    if (busy.current) return;
    busy.current = true;
    setPending(action);
    try {
      if (action === "restore") {
        await useChatSessionStore.getState().unarchiveSession(sessionId);
      } else {
        const result = await deleteArchivedChat(sessionId, queryClient);
        if (result.cleanupFailed)
          toast.warning(t("chats.deleteCleanupWarning"));
        else toast.success(t("chats.deleteSuccess"));
        setOpen(false);
      }
    } catch (error) {
      toast.error(t(errorMessageKey(error, action)));
    } finally {
      busy.current = false;
      setPending(null);
    }
  };

  return {
    open,
    setOpen,
    pending,
    restore: () => perform("restore"),
    confirmDelete: () => perform("delete"),
  };
}
