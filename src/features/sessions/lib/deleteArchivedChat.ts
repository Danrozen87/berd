import type { QueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import {
  useChatSessionStore,
  SessionDeletionUnavailableError,
} from "@/features/chat/stores/chatSessionStore";
import {
  useChatStore,
  isSessionRuntimeSettled,
} from "@/features/chat/stores/chatStore";
import { useHomeWidgetStore } from "@/features/home/stores/homeWidgetStore";
import { forgetSessionSearch } from "@/shared/api/sessionSearch";
import { unregisterSessionBackend } from "@/shared/api/acpSessionBackends";
import { clearActiveMessageId } from "@/shared/api/acpActiveMessageTracking";

import { forgetPersistedDraft } from "@/features/chat/stores/draftPersistence";
import { forgetPersistedMessageQueue } from "@/features/chat/stores/queuePersistence";
import { forgetPersistedUnreadSession } from "@/features/chat/stores/unreadPersistence";
import { forgetPersistedAutoMode } from "@/features/chat/stores/autoModePersistence";
import { forgetPersistedWorkspaceMetadata } from "@/features/chat/stores/workspaceAttachmentPersistence";
import { forgetPersistedRemoteSession } from "@/features/chat/stores/remoteSessionPersistence";
import { useVoiceConversationStore } from "@/features/voice-conversation/stores/voiceConversationStore";

/** Delete canonical history first, then dispose Berd-owned projections of it. */
export async function deleteArchivedChat(
  sessionId: string,
  queryClient: QueryClient,
): Promise<{ cleanupFailed: boolean }> {
  const session = useChatSessionStore.getState().getSession(sessionId);
  const chat = useChatStore.getState();
  const runtime = chat.sessionStateById[sessionId];
  const voice = useVoiceConversationStore.getState();
  if (
    !session?.archivedAt ||
    chat.loadingSessionIds.has(sessionId) ||
    (runtime &&
      (!isSessionRuntimeSettled(runtime) ||
        runtime.streamingMessageId !== null)) ||
    voice.requestedStartSessionId === sessionId ||
    (voice.status.sessionId === sessionId &&
      voice.status.lifecycle !== "stopped")
  ) {
    throw new SessionDeletionUnavailableError();
  }
  const result = await useChatSessionStore
    .getState()
    .deleteArchivedSession(sessionId);
  const cleanup = await Promise.allSettled(
    [
      () => useChatStore.getState().cleanupSession(sessionId),
      () => forgetSessionSearch(queryClient, sessionId),
      () => useHomeWidgetStore.getState().removeChatPins(sessionId),
      () => forgetPersistedDraft(sessionId),
      () => forgetPersistedMessageQueue(sessionId),
      () => forgetPersistedUnreadSession(sessionId),
      () => forgetPersistedAutoMode(sessionId),
      () => forgetPersistedWorkspaceMetadata(sessionId),
      () => forgetPersistedRemoteSession(sessionId),
      () =>
        session.remoteHost
          ? undefined
          : invoke("forget_session_search_cache", { sessionId }),
    ].map((task) => Promise.resolve().then(task)),
  );
  clearActiveMessageId(sessionId);
  unregisterSessionBackend(sessionId);
  return {
    cleanupFailed:
      result.cleanupFailed ||
      cleanup.some((task) => task.status === "rejected"),
  };
}
