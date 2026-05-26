// exif.js — Extract GPS coordinates from photo EXIF data (extracted Stage 4)

// Try to extract GPS from photo EXIF data first
function getExifLocation(file) {
  return new Promise((resolve) => {
    if (!window.EXIF) { resolve(null); return; }
    EXIF.getData(file, function() {
      try {
        const lat = EXIF.getTag(this, 'GPSLatitude');
        const latRef = EXIF.getTag(this, 'GPSLatitudeRef');
        const lng = EXIF.getTag(this, 'GPSLongitude');
        const lngRef = EXIF.getTag(this, 'GPSLongitudeRef');
        if (lat && lng) {
          const latDec = convertDMSToDD(lat, latRef);
          const lngDec = convertDMSToDD(lng, lngRef);
          if (latDec && lngDec) {
            console.log('📍 GPS from photo EXIF:', latDec, lngDec);
            resolve({ lat: latDec, lng: lngDec, source: 'exif' });
          } else resolve(null);
        } else {
          console.log('📍 No EXIF GPS data in photo');
          resolve(null);
        }
      } catch(e) { resolve(null); }
    });
  });
}

// Convert degrees/minutes/seconds to decimal degrees
function convertDMSToDD(dms, ref) {
  if (!dms || dms.length < 3) return null;
  const dd = dms[0] + dms[1]/60 + dms[2]/3600;
  return (ref === 'S' || ref === 'W') ? -dd : dd;
}
