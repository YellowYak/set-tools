/**
 * firebase-init.js — Single Firebase app initialization.
 *
 * Both auth.js and db.js import from here so initializeApp is
 * only ever called once, regardless of module evaluation order.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js';
import { getAuth }        from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js';
import { getDatabase }    from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-database.js';

const firebaseConfig = {
  apiKey:            'AIzaSyCDxnbpchJomX9IPvz4ZQmuF6LzXTStPDU',
  authDomain:        'set-card-game-ddd65.web.app',
  projectId:         'set-card-game-ddd65',
  storageBucket:     'set-card-game-ddd65.firebasestorage.app',
  messagingSenderId: '546340267398',
  appId:             '1:546340267398:web:4956237f9c298da7cbf807',
  databaseURL:       'https://set-card-game-ddd65-default-rtdb.firebaseio.com',
};

export const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const rtdb = getDatabase(app);
