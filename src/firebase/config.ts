// ── Firebase Configuration ──
// Replace these values with your Firebase project config.
// Get them from: Firebase Console → Project Settings → Web App → Config

export const firebaseConfig = {
  apiKey: 'AIzaSyDjZvzodx2TQju3S8SWpyBvwP3FjYFSe4o',
  authDomain: 'human-compiler.firebaseapp.com',
  projectId: 'human-compiler',
  storageBucket: 'human-compiler.firebasestorage.app',
  messagingSenderId: '139332749336',
  appId: '1:139332749336:web:061b0fc621cca23ac6db6d',
  measurementId: 'G-58NZZMF8CT',
};

// Automatically enabled once apiKey is filled in
export const FIREBASE_ENABLED = firebaseConfig.apiKey !== '';
