// Firebase settings for cloud sync (Firebase console → Project settings → Your apps → tracker-web).
// These are not passwords: they are meant to be public. Your data is protected by
// Google sign-in and the Firestore security rules (see README).
// Leave apiKey empty to run the tracker without cloud sync.
export const firebaseConfig = {
  apiKey: 'AIzaSyBkIHmTNlIfAWoyTz639cM8OSGTFbjcZSM',
  authDomain: 'project-1-7b491.firebaseapp.com',
  projectId: 'project-1-7b491',
  storageBucket: 'project-1-7b491.firebasestorage.app',
  messagingSenderId: '599333559132',
  appId: '1:599333559132:web:ff6ec86215a07b1a05ff99',
};

// ---- Scan receipt (Firebase AI Logic + Gemini) ----
// reCAPTCHA Enterprise site key for App Check (Google Cloud console → Security → reCAPTCHA).
// Paste it between the quotes. Leave empty and the scanner stays off.
export const recaptchaKey = '6LeVzw0uAAAAACKni4FPPjXQ6htNnZxVJcDPaAcs';
// Gemini models to try, in order (the first one that works on your plan is used).
export const aiModels = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
