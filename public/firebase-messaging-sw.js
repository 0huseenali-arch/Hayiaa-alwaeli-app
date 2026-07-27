/* firebase-messaging-sw.js
 * سيرفس وركر مخصص لاستقبال إشعارات Firebase Cloud Messaging بالخلفية.
 * لازم يبقى بنفس الأسماء والمسار: public/firebase-messaging-sw.js
 *
 * ⚠️ عدّل القيم التالية لتطابق تماماً القيم الموجودة في src/firebase.js
 * (السيرفس وركر ما يقدر يقرأ متغيرات البيئة import.meta.env، لازم يكتبها صريحة هنا)
 */
importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDFyFRGxprf7mRuy93bbtxeBQtkPnzBDMY",
  authDomain: "alwaeli-e5bf0.firebaseapp.com",
  databaseURL: "https://alwaeli-e5bf0-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "alwaeli-e5bf0",
  storageBucket: "alwaeli-e5bf0.firebasestorage.app",
  messagingSenderId: "873691549287",
  appId: "1:873691549287:web:6987fcf704d2a8970f0ec2",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  const type = payload.data && payload.data.type;

  self.registration.showNotification(title || "هيئة الشيخ أحمد الوائلي", {
    body: body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    dir: "rtl",
    lang: "ar",
    data: payload.data || {},
    vibrate: type === "adhan" ? [400, 200, 400, 200, 400] : [200, 100, 200],
    tag: type || "general",
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const type = event.notification.data && event.notification.data.type;
  const url = type === "adhan" ? "/?openAdhan=1" : "/";
  event.waitUntil(clients.openWindow(url));
});
