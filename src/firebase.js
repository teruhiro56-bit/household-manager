import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey:            "AIzaSyAhuz8T4cCBu4AglJTc3l7ZbZzJxIX4Niw",
  authDomain:        "household-manager-6cb86.firebaseapp.com",
  projectId:         "household-manager-6cb86",
  storageBucket:     "household-manager-6cb86.firebasestorage.app",
  messagingSenderId: "588774413326",
  appId:             "1:588774413326:web:241e5206e40e538960185f",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);