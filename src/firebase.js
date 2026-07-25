// إعداد Firebase الخاص بمشروع هيئة الشيخ أحمد الوائلي
// هذه المفاتيح آمنة للنشر العلني في كود الواجهة (Client Config)،
// الحماية الفعلية تكون عبر "قواعد الأمان" (Security Rules) من لوحة Firebase.

import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";
import { getMessaging, isSupported } from "firebase/messaging";

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
export const fileStorage = getStorage(app);

// مفتاح Web Push العام (VAPID) — من Firebase Console > Project settings > Cloud Messaging > Web Push certificates
export const VAPID_KEY = "BMKfk1tzNy-5bVYRBjvTsPWZoyF5gf5TOzz94jtuPs7GYM9Fob0gt197JdSWg4teIWzbg0zrIArQCNkkL9YlR5k";

// دالة آمنة لجلب Messaging (بعض المتصفحات القديمة أو أوضاع التصفح الخفي لا تدعمه)
export async function getMessagingInstance() {
  const supported = await isSupported().catch(() => false);
  if (!supported) return null;
  return getMessaging(app);
}

export default app;
