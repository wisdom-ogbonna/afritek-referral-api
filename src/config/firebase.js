const admin = require('firebase-admin');
const dotenv = require('dotenv');

dotenv.config();

const serviceAccount = {
  project_id: process.env.FIREBASE_PROJECT_ID,
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  private_key: process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined,
};

if (!serviceAccount.project_id) {
  throw new Error('FIREBASE_PROJECT_ID is missing');
}

if (!serviceAccount.client_email) {
  throw new Error('FIREBASE_CLIENT_EMAIL is missing');
}

if (!serviceAccount.private_key) {
  throw new Error('FIREBASE_PRIVATE_KEY is missing');
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
}

const auth = admin.auth();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

module.exports = {
  admin,
  auth,
  db,
  FieldValue,
};