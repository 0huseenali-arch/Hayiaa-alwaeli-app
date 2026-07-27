// src/notifications.js
// وحدة إدارة إشعارات FCM في الواجهة.
// ⚠️ عدّل مسار الاستيراد './firebase' إذا كان app مصدّر بشكل مختلف عندك.

import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./firebase";

// من Firebase Console → Project Settings → Cloud Messaging → Web Push certificates
const VAPID_KEY = "BMKfk1tzNy-5bVYRBjvTsPWZoyF5gf5TOzz94jtuPs7GYM9Fob0gt197JdSWg4teIWzbg0zrIArQCNkkL9YlR5k";

export const GOVERNORATES = [
  { slug: "baghdad", name: "بغداد" },
  { slug: "basra", name: "البصرة" },
  { slug: "nineveh", name: "نينوى" },
  { slug: "erbil", name: "أربيل" },
  { slug: "sulaymaniyah", name: "السليمانية" },
  { slug: "duhok", name: "دهوك" },
  { slug: "kirkuk", name: "كركوك" },
  { slug: "najaf", name: "النجف الأشرف" },
  { slug: "karbala", name: "كربلاء المقدسة" },
  { slug: "babil", name: "بابل" },
  { slug: "wasit", name: "واسط" },
  { slug: "maysan", name: "ميسان" },
  { slug: "dhiqar", name: "ذي قار" },
  { slug: "muthanna", name: "المثنى" },
  { slug: "qadisiyyah", name: "القادسية" },
  { slug: "anbar", name: "الأنبار" },
  { slug: "salahaldin", name: "صلاح الدين" },
  { slug: "diyala", name: "ديالى" },
];

export const DEFAULT_PREFS = {
  newPost: true,
  prayerTimes: true,
  adhan: false,
  dailyVerse: true,
};

/**
 * يطلب إذن الإشعارات، يسجّل السيرفس وركر، يجيب توكن FCM،
 * ويرسله للسيرفر عبر دالة updateNotificationSubscriptions.
 */
export async function enableNotifications(governorate, prefs) {
  try {
    if (!("Notification" in window)) {
      return { success: false, reason: "unsupported" };
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return { success: false, reason: "denied" };
    }

    const registration = await navigator.serviceWorker.register(
      "/firebase-messaging-sw.js"
    );

    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (!token) return { success: false, reason: "no-token" };

    const functions = getFunctions(app);
    const updateSubs = httpsCallable(functions, "updateNotificationSubscriptions");
    await updateSubs({ token, governorate, prefs });

    localStorage.setItem("push_token", token);
    localStorage.setItem(
      "push_settings",
      JSON.stringify({ governorate, prefs })
    );

    return { success: true, token };
  } catch (err) {
    console.error("خطأ بتفعيل الإشعارات:", err);
    return { success: false, reason: err.message };
  }
}

/** يقرأ آخر إعدادات محفوظة محلياً (لعرضها بصفحة الإعدادات) */
export function getSavedNotificationSettings() {
  try {
    const raw = localStorage.getItem("push_settings");
    return raw ? JSON.parse(raw) : { governorate: null, prefs: DEFAULT_PREFS };
  } catch {
    return { governorate: null, prefs: DEFAULT_PREFS };
  }
}

/**
 * يستمع للإشعارات وقت يكون التطبيق مفتوح بالمقدمة (foreground) —
 * فوق ذلك يشغّل صوت الأذان تلقائياً إذا كان النوع adhan.
 * يُستدعى مرة وحدة عند إقلاع التطبيق (مثلاً بـ useEffect بملف App.jsx).
 */
export function listenForegroundMessages(onNotification) {
  try {
    const messaging = getMessaging(app);
    return onMessage(messaging, (payload) => {
      const type = payload.data?.type;

      if (type === "adhan") {
        const audio = new Audio("/adhan.mp3");
        audio.play().catch(() => {});
      }

      if (typeof onNotification === "function") {
        onNotification(payload);
      }
    });
  } catch (err) {
    console.error("خطأ بالاستماع للإشعارات:", err);
    return () => {};
  }
}
