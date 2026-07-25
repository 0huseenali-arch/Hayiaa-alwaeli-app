// public/firebase-messaging-sw.js
// عامل الخدمة (Service Worker) المسؤول عن استقبال الإشعارات
// وفتح التطبيق عند الضغط عليها، حتى لو كان التطبيق مغلقاً

importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

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

// استقبال الإشعار والتطبيق بالخلفية أو مغلق
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || payload.data?.title || "هيئة الشيخ أحمد الوائلي";
  const body = payload.notification?.body || payload.data?.body || "";
  const url = payload.data?.url || "/";

  self.registration.showNotification(title, {
    body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url },
  });
});

// عند الضغط على الإشعار، افتح التطبيق على الرابط المطلوب
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
