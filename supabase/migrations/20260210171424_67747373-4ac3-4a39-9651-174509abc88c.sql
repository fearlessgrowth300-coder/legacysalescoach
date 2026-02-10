
-- Profiles table for user data
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

-- Trigger to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', ''), NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Workspaces table
CREATE TABLE public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  niche_description TEXT,
  instagram_url TEXT,
  tiktok_url TEXT,
  store_url TEXT,
  default_reply_mode TEXT NOT NULL DEFAULT 'friend',
  is_active BOOLEAN NOT NULL DEFAULT false,
  profile_analysis TEXT,
  products_detected TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own workspaces" ON public.workspaces FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Prospects table
CREATE TABLE public.prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  instagram_url TEXT,
  tiktok_url TEXT,
  store_url TEXT,
  conversation_stage TEXT NOT NULL DEFAULT 'first_contact',
  outcome TEXT NOT NULL DEFAULT 'active',
  reply_mode TEXT NOT NULL DEFAULT 'friend',
  suggested_first_message TEXT,
  detected_interests TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.prospects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own prospects" ON public.prospects FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Chat messages table
CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prospect_id UUID NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'inbound',
  thread_type TEXT NOT NULL DEFAULT 'friend',
  screenshot_url TEXT,
  detected_tone TEXT,
  is_ai_suggestion BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own messages" ON public.chat_messages FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Knowledge base items table
CREATE TABLE public.knowledge_base_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'url',
  url TEXT,
  status TEXT NOT NULL DEFAULT 'processing',
  brain_type TEXT NOT NULL DEFAULT 'both',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.knowledge_base_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own kb items" ON public.knowledge_base_items FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Knowledge chunks table
CREATE TABLE public.knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_id UUID REFERENCES public.knowledge_base_items(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'general',
  content TEXT NOT NULL,
  brain_type TEXT NOT NULL DEFAULT 'both',
  trigger_phrases TEXT,
  relevance_score INTEGER NOT NULL DEFAULT 50,
  source_type TEXT NOT NULL DEFAULT 'content',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own chunks" ON public.knowledge_chunks FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_workspaces_updated_at BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_prospects_updated_at BEFORE UPDATE ON public.prospects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_kb_items_updated_at BEFORE UPDATE ON public.knowledge_base_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
