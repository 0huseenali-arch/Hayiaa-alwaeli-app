// src/notifications.js
// وحدة إدارة إشعارات FCM في الواجهة.

import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getApp } from "firebase/app";
import "./firebase"; // يضمن تهيئة تطبيق Firebase قبل أي استخدام هنا

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

// يمنع بقاء العملية عالقة للأبد إذا تعثّر أي خطوة (شبكة بطيئة، سيرفس وركر، الخ)
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`انتهت المهلة: ${label}`)), ms)
    ),
  ]);
}

/**
 * يطلب إذن الإشعارات، يسجّل السيرفس وركر، يجيب توكن FCM،
 * ويرسله للسيرفر عبر دالة updateNotificationSubscriptions.
 */
export async function enableNotifications(governorate, prefs) {
  try {
    if (!("Notification" in window)) {
      return { success: false, reason: "unsupported" };
    }

    // إذا الإذن مفعّل أو مرفوض مسبقاً، ما نطلبه من جديد (يمنع نافذة
    // إذن متكررة قد تعلق إذا ضغط المستخدم برّه النافذة بدون رد)
    let permission = Notification.permission;
    if (permission === "default") {
      permission = await withTimeout(
        Notification.requestPermission(),
        20000,
        "إذن الإشعارات"
      );
    }
    if (permission !== "granted") {
      return { success: false, reason: "denied" };
    }

    const registration = await withTimeout(
      navigator.serviceWorker.register("/firebase-messaging-sw.js"),
      15000,
      "تسجيل السيرفس وركر"
    );

    const messaging = getMessaging(getApp());
    const token = await withTimeout(
      getToken(messaging, {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: registration,
      }),
      15000,
      "جلب رمز الجهاز"
    );

    if (!token) return { success: false, reason: "no-token" };

    const functions = getFunctions(getApp());
    const updateSubs = httpsCallable(functions, "updateNotificationSubscriptions");
    await withTimeout(
      updateSubs({ token, governorate, prefs }),
      20000,
      "تسجيل الاشتراك بالسيرفر"
    );

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
    const messaging = getMessaging(getApp());
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
