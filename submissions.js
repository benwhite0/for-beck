/* Firestore CRUD operations for submissions */

import {
  db,
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
  serverTimestamp
} from './firebase.js';

import { uploadMedia } from './media.js';

export async function fetchSectionPosts(section) {
  const q = query(
    collection(db, 'submissions'),
    where('section', '==', section),
    where('verified', '==', true),
    orderBy('postedAt', 'desc'),
    limit(100)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function fetchEntryById(id) {
  const d = await getDoc(doc(db, 'submissions', id));
  if (!d.exists()) return null;
  const data = d.data();
  if (!data.verified) return null;
  return { id: d.id, ...data };
}

export async function createSubmission({ author, email = '', credits, section, eventDate, title, content, file }, onProgress) {
  const { mediaURL, mediaType } = await uploadMedia(file, section, onProgress);
  const payload = {
    author,
    email: email.trim(),
    credits,
    section,
    eventDate: eventDate || '',
    title: (title || '').trim(),
    content,
    mediaURL,
    mediaType,
    verified: false,
    postedAt: serverTimestamp()
  };
  const ref = await addDoc(collection(db, 'submissions'), payload);
  return ref.id;
}

export async function approveSubmission(id) {
  await updateDoc(doc(db, 'submissions', id), { verified: true });
}

