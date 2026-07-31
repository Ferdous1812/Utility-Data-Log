import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const url = supabaseUrl && supabaseUrl.startsWith('http') && !supabaseUrl.includes('your-project-url')
    ? supabaseUrl
    : 'https://placeholder.supabase.co';
  const key = supabaseAnonKey || 'placeholder-key';

  return createBrowserClient(url, key);
}
