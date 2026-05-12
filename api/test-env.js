export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    hasSupabaseUrl: Boolean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL),
    hasServiceKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    supabaseUrlValue: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || null,
  })
}