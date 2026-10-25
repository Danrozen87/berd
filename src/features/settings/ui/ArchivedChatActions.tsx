import { useTranslation } from "react-i18next";
import type { ChatSession } from "@/features/chat/stores/chatSessionStore";
import { getDisplaySessionTitle } from "@/features/chat/lib/sessionTitle";
import { Button } from "@/shared/ui/button";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { useArchivedChatActions } from "../hooks/useArchivedChatActions";

export function ArchivedChatActions({ session }: { session: ChatSession }) {
  const { t } = useTranslation(["settings", "common"]);
  const actions = useArchivedChatActions(session.id);
  const title = getDisplaySessionTitle(
    session.title,
    t("common:session.defaultTitle"),
  );
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="xs"
        disabled={actions.pending !== null}
        onClick={() => void actions.restore()}
      >
        {t("common:actions.restore")}
      </Button>
      <Button
        type="button"
        variant="ghost"
        destructive
        size="xs"
        disabled={actions.pending !== null}
        onClick={() => actions.setOpen(true)}
        aria-label={t("chats.deleteLabel", { title })}
      >
        {t("common:actions.delete")}
      </Button>
      <ConfirmDialog
        open={actions.open}
        onOpenChange={actions.setOpen}
        title={t("chats.deleteTitle", { title })}
        description={t("chats.deleteDescription")}
        cancelLabel={t("common:actions.cancel")}
        confirmLabel={t("chats.deleteConfirm")}
        loadingLabel={t("chats.deleting")}
        isLoading={actions.pending === "delete"}
        onConfirm={actions.confirmDelete}
      />
    </div>
  );
}
