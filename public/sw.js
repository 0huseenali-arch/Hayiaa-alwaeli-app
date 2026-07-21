/*
  Service Worker لتطبيق هيئة الشيخ أحمد الوائلي
  يوفّر عمل التطبيق بدون إنترنت (Offline) عبر تخزين الملفات الأساسية،
  مع استراتيجية ذكية: الشبكة أولاً للبيانات الحية، والذاكرة أولاً للملفات الثابتة.
*/

const CACHE_NAME = "hayaa-cache-v1";

// الملفات الأساسية التي يُخزّنها التطبيق ليعمل بدون نت
const CORE_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/favicon-32.png",
];

// عند التثبيت: خزّن الملفات الأساسية
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

// عند التفعيل: احذف النسخ القديمة من الذاكرة
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // نتعامل فقط مع طلبات GET
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // بيانات Firebase الحية والـ APIs: الشبكة أولاً (حتى تبقى محدّثة)،
  // ونرجع للذاكرة فقط عند انقطاع النت
  const isLiveData =
    url.hostname.includes("firebaseio.com") ||
    url.hostname.includes("firebasedatabase.app") ||
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("aladhan.com") ||
    url.hostname.includes("alquran.cloud");

  if (isLiveData) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // ملفات التطبيق الثابتة (كود، صور، خطوط): الذاكرة أولاً للسرعة والعمل بدون نت،
  // مع تحديث الذاكرة في الخلفية عند توفر النت
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === "basic") {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
