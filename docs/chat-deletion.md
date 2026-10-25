# Permanent chat deletion

Berd previously exposed archive and restore in its chat-management UI. The
pinned Goose backend already supports `session/delete`, and Berd had a client
helper used for temporary security-inference sessions. There is no documented
product rationale in the inspected code for omitting a user-facing delete action.

## First release

Archive a chat, then choose Delete in Settings → Archive → Archived chats.
The shared confirmation names the chat and explains that the action cannot be
undone. A running, open, restoring, or non-archived chat cannot be deleted here.
Deletion uses the existing backend operation; no Goose patch or second storage
implementation is introduced.

Canonical deletion removes the session, messages, and usage ledger in one backend
transaction. The client then removes its session metadata, messages, drafts,
queues, search corpora, home pins, and local search-index projection. In-flight
list responses cannot recreate a deleted row. Backend failure keeps the record
available until deletion can be confirmed. A lost response is reconciled through
the backend lookup and one bounded delete retry; database read errors alone are
not proof of absence. Cleanup failures after canonical success are reported separately.

This is logical deletion from Berd, not secure erasure of disks, snapshots,
provider retention, or separate Codex/Claude native history. Project files and
worktrees are not removed by Delete. The confirmation makes that scope explicit.

## Follow-up work

Direct deletion from active-chat menus needs the same canonical operation plus
coordinated cancellation, voice, window, navigation, and queue handling. Keep
that lifecycle coordination shared rather than adding menu-local mutations.
Batch deletion and retention schedules should build on the single-chat operation
with an explicit selection/count and failure reporting. Provider-native history
purging requires provider-supported APIs and a separate, clearly explained scope;
never guess paths and recursively remove shared agent homes.

Validate confirmation/cancel, pending and error states, failed backend calls,
restore/delete races, stale list responses, cache removal, and unaffected chats.
Only isolated fixtures are deleted during automated tests.
