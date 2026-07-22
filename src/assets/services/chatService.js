import { supabase } from './supabaseclient';
import { encryptForUsers, decryptForUser } from './alphabetEncryption';

// ── Conversation ──

/**
 * Get or create a conversation between current user and another user
 */
export async function getOrCreateConversation(currentUserId, otherUserId) {
  if (!currentUserId || !otherUserId) throw new Error('Both user IDs required');

  // Check if a conversation already exists between these two users
  // A 2-person chat is uniquely identified by the pair of participants
  const { data: myConvs } = await supabase
    .from('chat_participants')
    .select('conversation_id')
    .eq('user_id', currentUserId);

  const myConvIds = (myConvs || []).map(p => p.conversation_id);

  if (myConvIds.length > 0) {
    const { data: match } = await supabase
      .from('chat_participants')
      .select('conversation_id')
      .in('conversation_id', myConvIds)
      .eq('user_id', otherUserId)
      .maybeSingle();

    if (match) {
      return match.conversation_id;
    }
  }

  // Create new conversation — generate UUID client-side to avoid RLS on SELECT after INSERT
  const convId = crypto.randomUUID();
  const { error: convError } = await supabase
    .from('conversations')
    .insert({ id: convId });

  if (convError) throw convError;

  // Add participants
  const participants = [
    { conversation_id: convId, user_id: currentUserId },
    { conversation_id: convId, user_id: otherUserId },
  ];

  const { error: partError } = await supabase
    .from('chat_participants')
    .insert(participants);

  if (partError) throw partError;

  return convId;
}

/**
 * Get all conversations for the current user
 * Uses separate queries instead of embedded joins for reliability
 */
export async function getConversations(userId) {
  if (!userId) return [];

  // 1. Get all conversation IDs where user is a participant
  const { data: myParts, error: partError } = await supabase
    .from('chat_participants')
    .select('conversation_id')
    .eq('user_id', userId);

  if (partError) {
    console.warn('[Chat] Error fetching participants:', partError);
    throw partError;
  }
  if (!myParts || myParts.length === 0) return [];

  const convIds = myParts.map(p => p.conversation_id);

  // 2. Get conversation details
  const { data: convs, error: convError } = await supabase
    .from('conversations')
    .select('*')
    .in('id', convIds)
    .order('updated_at', { ascending: false });

  if (convError) {
    console.warn('[Chat] Error fetching conversations:', convError);
    throw convError;
  }
  if (!convs || convs.length === 0) return [];

  // 3. Get ALL other participant user_ids in one batch query
  const { data: allParticipants } = await supabase
    .from('chat_participants')
    .select('conversation_id, user_id')
    .in('conversation_id', convIds);

  // Build a map: conversation_id → other user's profile
  const otherUserIds = {};
  for (const p of allParticipants || []) {
    if (p.user_id !== userId) {
      otherUserIds[p.conversation_id] = p.user_id;
    }
  }

  // 4. Fetch ALL profiles in one batch query
  const uniqueUserIds = [...new Set(Object.values(otherUserIds).filter(Boolean))];
  let profilesMap = {};
  if (uniqueUserIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, avatar_url, roles')
      .in('id', uniqueUserIds);
    for (const p of profiles || []) {
      profilesMap[p.id] = p;
    }
  }

  // 5. Build results
  const convResults = await Promise.all(convs.map(async (conv) => {
    const otherUserId = otherUserIds[conv.id];
    const otherProfile = otherUserId ? (profilesMap[otherUserId] || null) : null;
    const unread = await getUnreadCount(conv.id, userId);

    return {
      ...conv,
      otherUser: otherProfile,
      unreadCount: unread,
    };
  }));

  return convResults;
}

/**
 * Get unread message count for a conversation
 */
export async function getUnreadCount(conversationId, userId) {
  const { data: participant } = await supabase
    .from('chat_participants')
    .select('last_read_at')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!participant?.last_read_at) {
    // Count all messages if never read
    const { count } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .neq('sender_id', userId);
    return count || 0;
  }

  const { count } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .neq('sender_id', userId)
    .gt('created_at', participant.last_read_at);

  return count || 0;
}

/**
 * Mark conversation as read
 */
export async function markAsRead(conversationId, userId) {
  const { error } = await supabase
    .from('chat_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', userId);

  if (error) console.warn('Error marking as read:', error);
}

// ── Messages ──

/**
 * Send an encrypted message
 */
export async function sendMessage(conversationId, senderId, content, participantIds) {
  const allIds = [...new Set([senderId, ...participantIds])];

  // Encrypt content for all participants
  const { ciphertext, iv } = await encryptForUsers(content, senderId, allIds);

  // Insert message with sender_id, then fetch profile separately
  const { data: msg, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      ciphertext,
      iv,
      encrypted_for: allIds,
    })
    .select()
    .single();

  if (error) throw error;

  // Fetch sender profile separately
  const { data: senderProfile } = await supabase
    .from('profiles')
    .select('id, username, avatar_url')
    .eq('id', senderId)
    .maybeSingle();

  const data = { ...msg, profiles: senderProfile };

  // Update conversation last_message_text with obfuscated preview
  const obfuscatedPreview = content.length > 80 ? content.slice(0, 80) + '...' : content;
  await supabase
    .from('conversations')
    .update({ last_message_text: obfuscatedPreview })
    .eq('id', conversationId);

  return data;
}

/**
 * Get messages for a conversation
 */
export async function getMessages(conversationId, limit = 50, before = null) {
  let query = supabase
    .from('messages')
    .select()
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (before) {
    query = query.lt('created_at', before);
  }

  const { data, error } = await query;
  if (error) throw error;

  // Fetch sender profiles separately
  const msgs = (data || []).reverse();
  if (msgs.length === 0) return [];

  const senderIds = [...new Set(msgs.map(m => m.sender_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, avatar_url')
    .in('id', senderIds);

  const profileMap = {};
  for (const p of profiles || []) {
    profileMap[p.id] = p;
  }

  return msgs.map(m => ({
    ...m,
    profiles: profileMap[m.sender_id] || null,
  }));
}

/**
 * Decrypt a message for the current user
 */
export async function decryptMessage(message, currentUserId) {
  if (!message.encrypted_for?.includes(currentUserId)) return null;
  return decryptForUser(
    message.ciphertext,
    message.iv,
    message.sender_id,
    message.encrypted_for,
    currentUserId
  );
}

/**
 * Subscribe to new messages in a conversation (realtime)
 */
export function subscribeToMessages(conversationId, onMessage) {
  return supabase
    .channel(`chat-${conversationId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      async (payload) => {
        // Fetch the full message
        const { data: msg } = await supabase
          .from('messages')
          .select()
          .eq('id', payload.new.id)
          .single();
        if (!msg) return;

        // Fetch sender profile separately
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, username, avatar_url')
          .eq('id', msg.sender_id)
          .maybeSingle();

        onMessage({ ...msg, profiles: profile });
      }
    )
    .subscribe();
}

/**
 * Subscribe to conversation updates (for unread count sidebar)
 */
/**
 * Delete a conversation by ID (cascade deletes messages and participants)
 */
export async function deleteConversation(conversationId) {
  const { error } = await supabase
    .from('conversations')
    .delete()
    .eq('id', conversationId);

  if (error) {
    console.error('Error deleting conversation:', error);
    throw error;
  }
}

/**
 * Subscribe to conversation updates (for unread count sidebar)
 */
export function subscribeToConversations(userId, onUpdate) {
  return supabase
    .channel(`chat-convs-${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'conversations',
      },
      () => onUpdate()
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
      },
      () => onUpdate()
    )
    .subscribe();
}

