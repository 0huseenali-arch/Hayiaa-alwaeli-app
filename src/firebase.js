// إعداد Firebase الخاص بمشروع هيئة الشيخ أحمد الوائلي
// هذه المفاتيح آمنة للنشر العلني في كود الواجهة (Client Config)،
// الحماية الفعلية تكون عبر "قواعد الأمان" (Security Rules) من لوحة Firebase.

import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDFyFRGxprf7mRuy93bbtxeBQtkPnzBDMY",
  authDomain: "alwaeli-e5bf0.firebaseapp.com",
  databaseURL: "https://alwaeli-e5bf0-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "alwaeli-e5bf0",
  storageBucket: "alwaeli-e5bf0.firebasestorage.app",
  messagingSenderId: "873691549287",
  appId: "1:873691549287:web:6987fcf704d2a8970f0ec2",
};

const app = initializeApp(firebaseConfig);

export const db = getDatabase(app);
export const auth = getAuth(app);
export default app;


