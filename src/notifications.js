// src/notifications.js
// وحدة إدارة إشعارات OneSignal في الواجهة (بدل Firebase Cloud Messaging).
// يفترض هذا الملف أن كود تهيئة OneSignal (OneSignal.init) موجود بالفعل
// داخل index.html عبر window.OneSignalDeferred.

import { getFunctions, httpsCallable } from "firebase/functions";
import { getApp } from "firebase/app";
import "./firebase"; // يضمن تهيئة تطبيق Firebase قبل أي استخدام هنا

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
 * ينفّذ دالة تحتاج كائن OneSignal جاهز — يعمل بشكل صحيح حتى لو
 * استُدعي قبل أو بعد اكتمال OneSignal.init() بملف index.html.
 */
function withOneSignal(callback) {
  return new Promise((resolve, reject) => {
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (OneSignal) => {
      try {
        resolve(await callback(OneSignal));
      } catch (err) {
        reject(err);
      }
    });
  });
}

/** ينتظر ظهور معرّف الاشتراك (Player ID) بعد الموافقة على الإذن مباشرة */
async function waitForPlayerId(OneSignal, retries = 12, delayMs = 500) {
  for (let i = 0; i < retries; i++) {
    const id = OneSignal.User.PushSubscription.id;
    if (id) return id;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

/**
 * يطلب إذن الإشعارات عبر OneSignal، يجيب Player ID،
 * ويرسله للسيرفر عبر دالة updateNotificationSubscriptions.
 */
export async function enableNotifications(governorate, prefs) {
  try {
    if (!("Notification" in window)) {
      return { success: false, reason: "unsupported" };
    }

    const playerId = await withTimeout(
      withOneSignal(async (OneSignal) => {
        let permission = Notification.permission;
        if (permission === "default") {
          await OneSignal.Notifications.requestPermission();
        }
        if (Notification.permission !== "granted") {
          throw new Error("denied");
        }
        return waitForPlayerId(OneSignal);
      }),
      25000,
      "تفعيل إشعارات OneSignal"
    );

    if (!playerId) return { success: false, reason: "no-player-id" };

    const functions = getFunctions(getApp());
    const updateSubs = httpsCallable(functions, "updateNotificationSubscriptions");
    await withTimeout(
      updateSubs({ playerId, governorate, prefs }),
      20000,
      "تسجيل الاشتراك بالسيرفر"
    );

    localStorage.setItem("push_player_id", playerId);
    localStorage.setItem(
      "push_settings",
      JSON.stringify({ governorate, prefs })
    );

    return { success: true, playerId };
  } catch (err) {
    console.error("خطأ بتفعيل الإشعارات:", err);
    const reason = err.message === "denied" ? "denied" : err.message;
    return { success: false, reason };
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
 * ويشغّل صوت الأذان تلقائياً إذا كان النوع adhan.
 * يُستدعى مرة وحدة عند إقلاع التطبيق (مثلاً بـ useEffect بملف App.jsx).
 * يرجّع دالة "إلغاء الاستماع" لاستدعائها عند تفكيك المكوّن (unmount).
 */
export function listenForegroundMessages(onNotification) {
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  let detach = () => {};

  window.OneSignalDeferred.push((OneSignal) => {
    const handler = (event) => {
      const notification = event.getNotification();
      const data = notification?.additionalData || {};

      if (data.type === "adhan") {
        const audio = new Audio("/adhan.mp3");
        audio.play().catch(() => {});
      }

      if (typeof onNotification === "function") {
        onNotification({ data });
      }
      // نترك السلوك الافتراضي (عرض الإشعار) كما هو، بلا preventDefault
    };

    OneSignal.Notifications.addEventListener("foregroundWillDisplay", handler);
    detach = () =>
      OneSignal.Notifications.removeEventListener("foregroundWillDisplay", handler);
  });

  return () => detach();
}
