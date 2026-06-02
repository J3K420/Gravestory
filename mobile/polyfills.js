// Must be imported before anything that touches crypto (Supabase, etc.).
// Hermes ships no global `crypto` on some Android builds, so provide both
// getRandomValues (PKCE code verifier) and subtle.digest (S256 challenge).
import * as ExpoCrypto from 'expo-crypto';

const cryptoShim = globalThis.crypto ?? {};

if (typeof cryptoShim.getRandomValues !== 'function') {
  cryptoShim.getRandomValues = (array) => ExpoCrypto.getRandomValues(array);
}

if (!cryptoShim.subtle) {
  cryptoShim.subtle = {
    digest: async (_algorithm, data) => {
      const str = Array.from(new Uint8Array(data), (b) => String.fromCharCode(b)).join('');
      const hex = await ExpoCrypto.digestStringAsync(
        ExpoCrypto.CryptoDigestAlgorithm.SHA256,
        str,
        { encoding: ExpoCrypto.CryptoEncoding.HEX },
      );
      return new Uint8Array(hex.match(/.{2}/g).map((h) => parseInt(h, 16))).buffer;
    },
  };
}

if (!globalThis.crypto) {
  globalThis.crypto = cryptoShim;
}
