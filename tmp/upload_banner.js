import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = 'https://dmmydgioujpablalezsn.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRtbXlkZ2lvdWpwYWJsYWxlenNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2NTU1NzUsImV4cCI6MjA4NDIzMTU3NX0.Y3Kyabpb-gFne0_LXpyEzOOiS0iDuQuSDt6372-nDho';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function uploadBanner() {
  const filePath = "C:/Users/jros/.gemini/antigravity/brain/b68caa0f-e11d-43b3-b874-b0774555412b/media__1774860252601.png";
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = `event-banner-${Date.now()}.png`;

  const { data, error } = await supabase
    .storage
    .from('product-images')
    .upload(fileName, fileBuffer, {
      contentType: 'image/png',
      upsert: true
    });

  if (error) {
    console.error('Error:', error.message);
    return;
  }

  const { data: { publicUrl } } = supabase.storage.from('product-images').getPublicUrl(fileName);
  console.log('SUCCESS_URL:', publicUrl);
}

uploadBanner();
