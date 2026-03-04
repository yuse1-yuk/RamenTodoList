import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyApv_QlVysJ6H6Fo_Y8A-6pBEtBmsmclo8',
  authDomain: 'eatodo-d2940.firebaseapp.com',
  projectId: 'eatodo-d2940',
  storageBucket: 'eatodo-d2940.firebasestorage.app',
  messagingSenderId: '487077721044',
  appId: '1:487077721044:web:ab1df894f885f2db301c41',
  measurementId: 'G-9BESN6B525',
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
