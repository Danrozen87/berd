import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArchivedChatActions } from "./ArchivedChatActions";
import { SettingsRow } from "@/shared/ui/settings-row";
import { SettingsSection } from "@/shared/ui/settings-section";
import {
  type ChatSession,
  useChatSessionStore,
} from "@/features/chat/stores/chatSessionStore";
import { sessionActivityAt } from "@/features/chat/lib/sessionActivity";
import { getDisplaySessionTitle } from "@/features/chat/lib/sessionTitle";
import {
  listArchivedProjects,
  listProjects,
  type ProjectInfo,
} from "@/features/projects/api/projects";
import { useLocaleFormatting } from "@/shared/i18n";

export function ArchivedChatsSection() {
  const { t } = useTranslation(["settings", "common"]);
  const { formatRelativeTimeToNow } = useLocaleFormatting();
  const sessions = useChatSessionStore((state) => state.sessions);
  const archivedChats = useMemo(
    () => sessions.filter((session) => session.archivedAt),
    [sessions],
  );
  const [projectsById, setProjectsById] = useState<Map<string, ProjectInfo>>(
    new Map(),
  );

  useEffect(() => {
    Promise.all([listProjects(), listArchivedProjects()])
      .then(([active, archived]) => {
        const next = new Map<string, ProjectInfo>();
        for (const project of [...active, ...archived]) {
          next.set(project.id, project);
        }
        setProjectsById(next);
      })
      .catch(() => setProjectsById(new Map()));
  }, []);

  function describeChat(session: ChatSession): string {
    const date = formatRelativeTimeToNow(sessionActivityAt(session));
    if (!session.projectId) {
      return date;
    }
    const project = projectsById.get(session.projectId);
    return project ? `${date} · ${project.name}` : date;
  }

  return (
    <SettingsSection title={t("chats.sectionTitle")}>
      {archivedChats.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("chats.empty")}</p>
      ) : null}
      {archivedChats.map((session) => (
        <SettingsRow
          key={session.id}
          density="compact"
          label={
            <span className="block truncate">
              {getDisplaySessionTitle(
                session.title,
                t("common:session.defaultTitle"),
              )}
            </span>
          }
          description={describeChat(session)}
          descriptionClassName="truncate"
          action={<ArchivedChatActions session={session} />}
        />
      ))}
    </SettingsSection>
  );
}
