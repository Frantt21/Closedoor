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
      .select('id, username, avatar_url, banner_url, bio, pronouns, roles, is_private, interests, accent_color, accent_color_secondary, banner_position, avatar_position')
      .in('id', uniqueUserIds);
    for (const p of profiles || []) {
      profilesMap[p.id] = p;
    }
  }

  // 5. Fetch follower counts for all other users in one batch
  let followerCounts = {};
  if (uniqueUserIds.length > 0) {
    const countPromises = uniqueUserIds.map(async (uid) => {
      const { count } = await supabase
        .from('follows')
        .select('follower_id', { count: 'exact', head: true })
        .eq('following_id', uid)
        .eq('status', 'accepted');
      return { id: uid, followers: count || 0 };
    });
    const countResults = await Promise.all(countPromises);
    for (const r of countResults) {
      followerCounts[r.id] = r.followers;
    }
  }

  // 6. Build results
  const convResults = convs.map((conv) => {
    const otherUserId = otherUserIds[conv.id];
    const otherProfile = otherUserId ? (profilesMap[otherUserId] || null) : null;
    const unread = getUnreadCount(conv.id, userId);

    return {
      ...conv,
      otherUser: otherProfile ? {
        ...otherProfile,
        followerCount: followerCounts[otherUserId] || 0,
      } : null,
      unreadCount: unread,
    };
  });

  // Resolve unread counts (which are async)
  const resolved = await Promise.all(convResults.map(async (c) => ({
    ...c,
    unreadCount: await c.unreadCount,
  })));
  return resolved;
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
 * Get total unread chat message count across all conversations for a user
 */
export async function getTotalUnreadChatCount(userId) {
  if (!userId) return 0;
  try {
    const { data: participantRows } = await supabase
      .from('chat_participants')
      .select('conversation_id, last_read_at')
      .eq('user_id', userId);

    if (!participantRows || participantRows.length === 0) return 0;

    const unreadCounts = await Promise.all(
      participantRows.map(async (p) => {
        if (!p.last_read_at) {
          const { count } = await supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('conversation_id', p.conversation_id)
            .neq('sender_id', userId);
          return count || 0;
        }

        const { count } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('conversation_id', p.conversation_id)
          .neq('sender_id', userId)
          .gt('created_at', p.last_read_at);

        return count || 0;
      })
    );

    return unreadCounts.reduce((acc, c) => acc + c, 0);
  } catch (err) {
    console.warn('Error computing total unread chat count:', err);
    return 0;
  }
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
export async function sendMessage(conversationId, senderId, content, participantIds, replyTo = null) {
  const allIds = [...new Set([senderId, ...participantIds])];

  // Encrypt content for all participants
  const { ciphertext, iv } = await encryptForUsers(content, senderId, allIds);

  // Build insert payload
  const insertPayload = {
    conversation_id: conversationId,
    sender_id: senderId,
    ciphertext,
    iv,
    encrypted_for: allIds,
  };
  if (replyTo) {
    insertPayload.reply_to = replyTo;
  }

  // Insert message with sender_id, then fetch profile separately
  const { data: msg, error } = await supabase
    .from('messages')
    .insert(insertPayload)
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

  // Filter out messages where current user is in deleted_for
  // (we don't know the user here, so this is a pass-through;
  //  Chat.jsx does the actual filter after fetch)
  // Note: the caller should filter .filter(m => !m.deleted_for?.includes(userId))
  if (error) throw error;

  // Fetch sender profiles separately
  let msgs = (data || []).reverse();
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
        const { data: msg } = await supabase
          .from('messages')
          .select()
          .eq('id', payload.new.id)
          .single();
        if (!msg) return;

        const { data: profile } = await supabase
          .from('profiles')
          .select('id, username, avatar_url')
          .eq('id', msg.sender_id)
          .maybeSingle();

        onMessage({ ...msg, profiles: profile }, 'INSERT');
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      async (payload) => {
        const { data: msg } = await supabase
          .from('messages')
          .select()
          .eq('id', payload.new.id)
          .single();
        if (!msg) return;

        const { data: profile } = await supabase
          .from('profiles')
          .select('id, username, avatar_url')
          .eq('id', msg.sender_id)
          .maybeSingle();

        onMessage({ ...msg, profiles: profile }, 'UPDATE');
      }
    )
    .subscribe();
}

/**
 * Subscribe to conversation updates (for unread count sidebar)
 */
// ── Message Actions ──

/**
 * Permanently delete a message (own messages only)
 */
export async function deleteMessage(messageId) {
  const { error } = await supabase
    .from('messages')
    .delete()
    .eq('id', messageId);
  if (error) throw error;
}

/**
 * Delete a message "for me" (adds user to deleted_for array)
 */
export async function deleteMessageForMe(messageId, userId) {
  // Fetch current deleted_for
  const { data: msg } = await supabase
    .from('messages')
    .select('deleted_for')
    .eq('id', messageId)
    .single();
  if (!msg) return;

  const current = msg.deleted_for || [];
  if (current.includes(userId)) return;

  const { error } = await supabase
    .from('messages')
    .update({ deleted_for: [...current, userId] })
    .eq('id', messageId);
  if (error) throw error;
}

/**
 * Edit a message (re-encrypt with new content)
 */
export async function editMessage(messageId, senderId, newContent, participantIds) {
  const allIds = [...new Set([senderId, ...(participantIds || [])])];
  const { ciphertext, iv } = await encryptForUsers(newContent, senderId, allIds);

  const { error } = await supabase
    .from('messages')
    .update({
      ciphertext,
      iv,
      encrypted_for: allIds,
      edited_at: new Date().toISOString(),
    })
    .eq('id', messageId);
  if (error) throw error;
}

/**
 * Toggle pin on a message
 */
export async function pinMessage(messageId, pinned) {
  const { error } = await supabase
    .from('messages')
    .update({ is_pinned: pinned })
    .eq('id', messageId);
  if (error) throw error;
}

/**
 * Toggle emoji reaction on a message
 * reactions is a JSONB { [user_id]: "emoji" }
 * If same emoji, remove it; if different emoji, set it
 */
export async function addReaction(messageId, userId, emoji) {
  // Fetch current reactions
  const { data: msg } = await supabase
    .from('messages')
    .select('reactions')
    .eq('id', messageId)
    .single();
  if (!msg) return;

  const reactions = msg.reactions || {};
  if (reactions[userId] === emoji) {
    // Remove reaction
    delete reactions[userId];
  } else {
    // Set/change reaction
    reactions[userId] = emoji;
  }

  const { error } = await supabase
    .from('messages')
    .update({ reactions })
    .eq('id', messageId);
  if (error) throw error;
}

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

