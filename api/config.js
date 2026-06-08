// Returns public Supabase config to the frontend.
// The anon key is designed to be public (RLS protects data).
// Set SUPABASE_URL and SUPABASE_ANON_KEY in Vercel environment variables.

export default function handler(req, res) {
  const supabaseUrl     = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  // Cache for 1 hour — these values don't change
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.status(200).json({ supabaseUrl, supabaseAnonKey });
}
