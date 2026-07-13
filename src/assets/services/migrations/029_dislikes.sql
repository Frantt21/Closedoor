-- ── Dislikes table ──
-- Similar to likes, but for dislikes. Like and dislike are mutually exclusive.

CREATE TABLE IF NOT EXISTS public.dislikes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, post_id)
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_dislikes_user_id ON public.dislikes(user_id);
CREATE INDEX IF NOT EXISTS idx_dislikes_post_id ON public.dislikes(post_id);

-- Row Level Security
ALTER TABLE public.dislikes ENABLE ROW LEVEL SECURITY;

-- Anyone can read dislikes
CREATE POLICY "Anyone can read dislikes"
  ON public.dislikes FOR SELECT
  USING (true);

-- Authenticated users can insert their own dislikes
CREATE POLICY "Users can insert their own dislikes"
  ON public.dislikes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Authenticated users can delete their own dislikes
CREATE POLICY "Users can delete their own dislikes"
  ON public.dislikes FOR DELETE
  USING (auth.uid() = user_id);

-- ── Add dislikes_count column to posts ──
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS dislikes_count BIGINT NOT NULL DEFAULT 0;

-- ── Function: increment dislikes_count + remove like if exists ──
CREATE OR REPLACE FUNCTION public.handle_dislike()
RETURNS TRIGGER AS $$
BEGIN
  -- Increment dislikes_count on the post
  UPDATE public.posts SET dislikes_count = dislikes_count + 1 WHERE id = NEW.post_id;

  -- If user had liked this post, remove the like (mutual exclusion)
  DELETE FROM public.likes WHERE user_id = NEW.user_id AND post_id = NEW.post_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Function: decrement dislikes_count ──
CREATE OR REPLACE FUNCTION public.handle_undislike()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.posts SET dislikes_count = GREATEST(dislikes_count - 1, 0) WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Triggers ──
DROP TRIGGER IF EXISTS on_dislike ON public.dislikes;
CREATE TRIGGER on_dislike
  AFTER INSERT ON public.dislikes
  FOR EACH ROW EXECUTE FUNCTION public.handle_dislike();

DROP TRIGGER IF EXISTS on_undislike ON public.dislikes;
CREATE TRIGGER on_undislike
  AFTER DELETE ON public.dislikes
  FOR EACH ROW EXECUTE FUNCTION public.handle_undislike();

-- ── Function: decrement dislikes_count + remove dislike if exists when liking ──
CREATE OR REPLACE FUNCTION public.handle_like_on_dislike()
RETURNS TRIGGER AS $$
BEGIN
  -- If user had disliked this post, remove the dislike (mutual exclusion)
  DELETE FROM public.dislikes WHERE user_id = NEW.user_id AND post_id = NEW.post_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Trigger: remove dislike when inserting like ──
DROP TRIGGER IF EXISTS on_like_for_dislike ON public.likes;
CREATE TRIGGER on_like_for_dislike
  AFTER INSERT ON public.likes
  FOR EACH ROW EXECUTE FUNCTION public.handle_like_on_dislike();
