// ── Firebase Configuration ──
// Replace these values with your Firebase project config.
// Get them from: Firebase Console → Project Settings → Web App → Config

export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};

// Automatically enabled once apiKey is filled in
export const FIREBASE_ENABLED = firebaseConfig.apiKey !== '';
