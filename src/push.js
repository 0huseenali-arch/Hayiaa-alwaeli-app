// src/push.js
// إدارة إشعارات الدفع (Push Notifications) عبر Firebase Cloud Messaging
// يعتمد على Realtime Database لتخزين التوكنات وطابور الإشعارات

import { getToken, onMessage } from "firebase/messaging";
import { ref, set, push, serverTimestamp } from "firebase/database";
import { db, getMessagingInstance, VAPID_KEY } from "./firebase";

// طلب إذن الإشعارات وتسجيل توكن الجهاز في push_tokens
export async function enablePush() {
  try {
    const messaging = await getMessagingInstance();
    if (!messaging) {
      return { success: false, reason: "غير مدعوم على هذا المتصفح/الجهاز" };
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return { success: false, reason: "لم يتم منح الإذن" };
    }

    // تسجيل service worker المسؤول عن استقبال الإشعارات بالخلفية
    const registration = await navigator.serviceWorker.register(
      "/firebase-messaging-sw.js"
    );

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (!token) {
      return { success: false, reason: "تعذر الحصول على توكن الجهاز" };
    }

    // نخزن التوكن كمفتاح لتفادي التكرار لنفس الجهاز
    await set(ref(db, `push_tokens/${token}`), {
      token,
      createdAt: serverTimestamp(),
      userAgent: navigator.userAgent,
    });

    // استماع لإشعارات تصل والتطبيق مفتوح بالمقدمة
    onMessage(messaging, (payload) => {
      console.log("إشعار وصل والتطبيق مفتوح:", payload);
    });

    return { success: true, token };
  } catch (error) {
    console.error("خطأ بتفعيل الإشعارات:", error);
    return { success: false, reason: error.message };
  }
}

// إضافة إشعار جديد لطابور الإرسال (تقرأه Cloud Function وترسله فعلياً)
export async function queueNotification({ title, body, url = "/" }) {
  try {
    const queueRef = ref(db, "push_queue");
    await push(queueRef, {
      title,
      body,
      url,
      createdAt: serverTimestamp(),
      sent: false,
    });
    return { success: true };
  } catch (error) {
    console.error("خطأ بإضافة الإشعار للطابور:", error);
    return { success: false, reason: error.message };
  }
}
