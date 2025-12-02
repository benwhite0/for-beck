/* Firebase initialization and configuration */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInAnonymously, signOut, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js';
import { getFirestore, collection, addDoc, getDoc, getDocs, doc, query, where, orderBy, limit, updateDoc, deleteDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js';
import { getStorage, ref as storageRef, uploadBytes, uploadBytesResumable, getDownloadURL } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-storage.js';

const firebaseConfig = {
  apiKey: "AIzaSyChj8gAgnTq2H2YGMd0iHI4W44ztidh9K8",
  authDomain: "beck-742dc.firebaseapp.com",
  projectId: "beck-742dc",
  storageBucket: "beck-742dc.firebasestorage.app",
  messagingSenderId: "43212058207",
  appId: "1:43212058207:web:42c193dc771e51124ab5ea",
  measurementId: "G-59NXN5V5JM"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export const ADMIN_EMAILS = ['benjaminwhite02@gmail.com', 'fran@scabetti.co.uk', 'test@beck.com', 'beckbromleyunited@gmail.com'];

export const isAdminUser = (user) => !!(user && !user.isAnonymous && ADMIN_EMAILS.includes(user.email || ''));

// Re-export Firebase functions for use by other modules
export {
  onAuthStateChanged,
  signInAnonymously,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  collection,
  addDoc,
  getDoc,
  getDocs,
  doc,
  query,
  where,
  orderBy,
  limit,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  storageRef,
  uploadBytes,
  uploadBytesResumable,
  getDownloadURL
};

