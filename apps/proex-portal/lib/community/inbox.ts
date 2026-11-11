import type { PortalActor } from '../access';
import { chatOverview } from './chat';
import { unreadMessages } from './messages';
import { requireActor } from './shared';

export const INBOX_CONVERSATIONS = 12;
export type CommunityInboxConversation = { key: string; kind: 'project' | 'direct'; title: string; unread: number; lastMessageAt: string | null };

/*
 * What the bell shows about the Community: how many unread recados and which conversations have new messages.
 * Titles and counts only, never message text or the sender of a recado. Read-only: opening the bell marks nothing
 * as read; that still happens only when the person opens the recado or the conversation in the Community.
 * Access is the same as in the Community itself (chatOverview checks membership and each conversation).
 */
export async function communityInbox(db: D1Database, rawActor: PortalActor | null) {
  const actor = requireActor(rawActor);
  const overview = await chatOverview(db, actor);
  const rows: CommunityInboxConversation[] = [
    ...overview.projects.filter(row => Number(row.unread) > 0).map(row => ({ key: `p:${String(row.projectId)}`, kind: 'project' as const, title: String(row.name), unread: Number(row.unread), lastMessageAt: row.lastMessageAt ? String(row.lastMessageAt) : null })),
    ...overview.directs.filter(row => Number(row.unread) > 0).map(row => ({ key: `c:${String(row.conversationId)}`, kind: 'direct' as const, title: String(row.otherName), unread: Number(row.unread), lastMessageAt: row.lastMessageAt ? String(row.lastMessageAt) : null })),
  ].sort((a, b) => String(b.lastMessageAt ?? '').localeCompare(String(a.lastMessageAt ?? '')) || a.key.localeCompare(b.key));
  const messages = await unreadMessages(db, actor.userId);
  // One unit everywhere: messages. The bell number is the unread recados plus every new chat message, so it equals
  // the sum of the counts shown on the rows (including conversations beyond the listed ones).
  return { messages, conversations: rows.slice(0, INBOX_CONVERSATIONS), moreConversations: Math.max(0, rows.length - INBOX_CONVERSATIONS), unread: messages + rows.reduce((sum, row) => sum + row.unread, 0) };
}
