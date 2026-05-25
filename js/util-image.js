// ── IMAGE DOWNSCALING ───────────────────────────────────────────
// Resize a data URL to fit within maxDim on the long edge, re-encode as JPEG.
// Returns { dataUrl, originalSize, newSize }.
function downscaleImage(dataUrl, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const { width, height } = img;
      // If already small enough, skip the canvas round-trip
      if (width <= maxDim && height <= maxDim) {
        resolve({ dataUrl, originalSize: dataUrl.length, newSize: dataUrl.length });
        return;
      }
      const scale = maxDim / Math.max(width, height);
      const newW = Math.round(width * scale);
      const newH = Math.round(height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = newW;
      canvas.height = newH;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, newW, newH);
      try {
        const out = canvas.toDataURL('image/jpeg', quality);
        resolve({ dataUrl: out, originalSize: dataUrl.length, newSize: out.length });
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = dataUrl;
  });
}
