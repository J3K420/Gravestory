import { PROXY_BASE, CLIENT_KEY } from './config';

// Upload a compressed JPEG base64 string to Cloudflare R2 via the Worker proxy.
// Returns the public URL, or null on failure (failure is non-fatal — story saves fine without a photo).
export async function uploadGravestoneImage(base64) {
  try {
    const res = await fetch(`${PROXY_BASE}/upload-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Key': CLIENT_KEY },
      body: JSON.stringify({ data: base64, contentType: 'image/jpeg' }),
    });
    if (!res.ok) throw new Error(`R2 upload failed: ${res.status}`);
    const json = await res.json();
    return json.url || null;
  } catch (e) {
    console.warn('uploadGravestoneImage failed (non-fatal):', e.message);
    return null;
  }
}
