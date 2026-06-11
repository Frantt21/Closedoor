# Posts System - Supabase Setup

Ejecuta estas queries en el SQL Editor de Supabase **en orden**.

## 0. Eliminar tablas existentes (para regenerar desde cero)

```sql
-- Eliminar triggers primero
DROP TRIGGER IF EXISTS on_like_insert ON likes;
DROP TRIGGER IF EXISTS on_like_delete ON likes;
DROP TRIGGER IF EXISTS on_comment_insert ON comments;
DROP TRIGGER IF EXISTS on_comment_delete ON comments;
DROP TRIGGER IF EXISTS on_repost_insert ON reposts;
DROP TRIGGER IF EXISTS on_repost_delete ON reposts;

-- Eliminar funciones
DROP FUNCTION IF EXISTS increment_likes_count();
DROP FUNCTION IF EXISTS decrement_likes_count();
DROP FUNCTION IF EXISTS increment_comments_count();
DROP FUNCTION IF EXISTS decrement_comments_count();
DROP FUNCTION IF EXISTS increment_reposts_count();
DROP FUNCTION IF EXISTS decrement_reposts_count();

-- Eliminar tablas (orden inverso por foreign keys)
DROP TABLE IF EXISTS comment_likes CASCADE;
DROP TABLE IF EXISTS reposts CASCADE;
DROP TABLE IF EXISTS comments CASCADE;
DROP TABLE IF EXISTS likes CASCADE;
DROP TABLE IF EXISTS posts CASCADE;
```

## 1. Crear tablas

```sql
-- ============================================
-- POSTS TABLE
-- ============================================
CREATE TABLE posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  image_url TEXT,
  video_url TEXT,
  is_pinned BOOLEAN DEFAULT false,
  likes_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  reposts_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- LIKES TABLE
-- ============================================
CREATE TABLE likes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, post_id)
);

-- ============================================
-- COMMENTS TABLE (con soporte de respuestas)
-- ============================================
CREATE TABLE comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE NOT NULL,
  parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- COMMENT LIKES TABLE
-- ============================================
CREATE TABLE comment_likes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  comment_id UUID REFERENCES comments(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, comment_id)
);

-- ============================================
-- REPOSTS TABLE
-- ============================================
CREATE TABLE reposts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, post_id)
);
```

## 2. Indexes

```sql
-- Posts
CREATE INDEX idx_posts_user_id ON posts(user_id);
CREATE INDEX idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX idx_posts_pinned ON posts(user_id, is_pinned) WHERE is_pinned = true;

-- Likes
CREATE INDEX idx_likes_user_id ON likes(user_id);
CREATE INDEX idx_likes_post_id ON likes(post_id);

-- Comments
CREATE INDEX idx_comments_post_id ON comments(post_id);
CREATE INDEX idx_comments_user_id ON comments(user_id);
CREATE INDEX idx_comments_parent_id ON comments(parent_id) WHERE parent_id IS NOT NULL;

-- Comment likes
CREATE INDEX idx_comment_likes_user_id ON comment_likes(user_id);
CREATE INDEX idx_comment_likes_comment_id ON comment_likes(comment_id);

-- Reposts
CREATE INDEX idx_reposts_user_id ON reposts(user_id);
CREATE INDEX idx_reposts_post_id ON reposts(post_id);
```

## 3. RLS Policies

```sql
-- Enable RLS
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE reposts ENABLE ROW LEVEL SECURITY;

-- ========== POSTS ==========

CREATE POLICY "Anyone can view posts" ON posts
  FOR SELECT USING (true);

CREATE POLICY "Users can create posts" ON posts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own posts" ON posts
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own posts" ON posts
  FOR DELETE USING (auth.uid() = user_id);

-- ========== LIKES ==========

CREATE POLICY "Anyone can view likes" ON likes
  FOR SELECT USING (true);

CREATE POLICY "Users can create likes" ON likes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own likes" ON likes
  FOR DELETE USING (auth.uid() = user_id);

-- ========== COMMENTS ==========

CREATE POLICY "Anyone can view comments" ON comments
  FOR SELECT USING (true);

CREATE POLICY "Users can create comments" ON comments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own comments" ON comments
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own comments" ON comments
  FOR DELETE USING (auth.uid() = user_id);

-- ========== REPOSTS ==========

CREATE POLICY "Anyone can view reposts" ON reposts
  FOR SELECT USING (true);

CREATE POLICY "Users can create reposts" ON reposts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own reposts" ON reposts
  FOR DELETE USING (auth.uid() = user_id);

-- ========== COMMENT LIKES ==========

ALTER TABLE comment_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view comment likes" ON comment_likes
  FOR SELECT USING (true);

CREATE POLICY "Users can create comment likes" ON comment_likes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own comment likes" ON comment_likes
  FOR DELETE USING (auth.uid() = user_id);
```

## 4. Triggers for denormalized counters

```sql
-- ========== LIKES COUNTER ==========

CREATE OR REPLACE FUNCTION increment_likes_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_likes_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_like_insert
  AFTER INSERT ON likes
  FOR EACH ROW EXECUTE FUNCTION increment_likes_count();

CREATE TRIGGER on_like_delete
  AFTER DELETE ON likes
  FOR EACH ROW EXECUTE FUNCTION decrement_likes_count();

-- ========== COMMENTS COUNTER ==========

CREATE OR REPLACE FUNCTION increment_comments_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_comments_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_comment_insert
  AFTER INSERT ON comments
  FOR EACH ROW EXECUTE FUNCTION increment_comments_count();

CREATE TRIGGER on_comment_delete
  AFTER DELETE ON comments
  FOR EACH ROW EXECUTE FUNCTION decrement_comments_count();

-- ========== REPOSTS COUNTER ==========

CREATE OR REPLACE FUNCTION increment_reposts_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE posts SET reposts_count = reposts_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_reposts_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE posts SET reposts_count = GREATEST(reposts_count - 1, 0) WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_repost_insert
  AFTER INSERT ON reposts
  FOR EACH ROW EXECUTE FUNCTION increment_reposts_count();

CREATE TRIGGER on_repost_delete
  AFTER DELETE ON reposts
  FOR EACH ROW EXECUTE FUNCTION decrement_reposts_count();
```
