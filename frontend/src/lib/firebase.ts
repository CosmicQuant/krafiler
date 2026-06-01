/**
 * firebase.ts
 *
 * Firebase client SDK initialization for the KRAFILER frontend.
 * Auth + Firestore real-time listeners.
 */

import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: 'AIzaSyCjKhlzHKMWkm0V-TTHQZASYBsb3lJ5I7o',
    authDomain: 'taxpulse-498006.firebaseapp.com',
    projectId: 'taxpulse-498006',
    storageBucket: 'taxpulse-498006.firebasestorage.app',
    messagingSenderId: '466434212488',
    appId: '1:466434212488:web:9fbe3117674fd605d8153d',
    measurementId: 'G-M3SSXSC9SK',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);

// Optional: force account selection every time (useful for testing multiple users)
// googleProvider.setCustomParameters({ prompt: 'select_account' });
