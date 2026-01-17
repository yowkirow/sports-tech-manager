import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://dmmydgioujpablalezsn.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRtbXlkZ2lvdWpwYWJsYWxlenNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2NTU1NzUsImV4cCI6MjA4NDIzMTU3NX0.Y3Kyabpb-gFne0_LXpyEzOOiS0iDuQuSDt6372-nDho';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
