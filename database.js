const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mcaichwewoejuywyojxd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_DEgpPbwXix73lKFCZA1pMw_fLX758VQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

module.exports = { supabase };
