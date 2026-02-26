/**
 * db.js — Firestore helpers for the Set card game.
 *
 * Exports saveGame(data) — writes a completed game record to the
 * /games collection. The caller is responsible for only calling
 * this when a user is signed in.
 */

import {
  getFirestore, collection, addDoc, serverTimestamp,
  query, where, orderBy, getDocs,
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore-lite.js';
import { app } from './firebase-init.js';

/**
 * Fetch all completed games for a user, newest first.
 * Requires a Firestore composite index on (uid ASC, completedAt DESC).
 * If the index doesn't exist yet, Firestore returns an error whose message
 * contains a direct link to create it in the Firebase console.
 *
 * @param {string} uid
 * @returns {Promise<Object[]>}
 */
export async function getGames(uid) {
  const db = getFirestore(app);
  const q = query(
    collection(db, 'games'),
    where('uid', '==', uid),
    orderBy('completedAt', 'desc'),
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Save a completed game to Firestore.
 * @param {Object} data  Game record (see schema in db.js / plan).
 * @returns {Promise<void>}
 *
 * NOTE: Uses firebase-firestore-lite.js (REST API) rather than the full SDK
 * (WebChannel). The full SDK sends a TYPE=terminate request whenever it opens
 * a new write stream after an auth-state change (anonymous → signed-in), and
 * that request gets blocked by browser privacy extensions — leaving the client
 * broken for the entire session. The Lite SDK uses plain fetch() requests with
 * no persistent connection or stream teardown, so this problem cannot occur.
 * The trade-off is no real-time listeners or offline persistence, neither of
 * which we need for one-shot game saves.
 */
export async function saveGame(data) {
  const db = getFirestore(app);
  await addDoc(collection(db, 'games'), {
    ...data,
    completedAt: serverTimestamp(),
  });
}
