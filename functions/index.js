/**
 * ============================================================
 *  إشعارات تطبيق هيئة الشيخ أحمد الوائلي — Cloud Functions
 *  (النسخة المعتمدة على OneSignal بدل Firebase Cloud Messaging)
 * ============================================================
 *  4 أنواع إشعارات:
 *   1) منشور جديد من الهيئة       -> tag: pref_newPost = "1"
 *   2) تذكير مواقيت الصلاة        -> tag: pref_prayerTimes = "1"
 *   3) أذان عند دخول الوقت        -> tag: pref_adhan = "1"
 *   4) آية / حكمة يومية           -> tag: pref_dailyVerse = "1"
 *
 *  كل مستخدم عنده tag لمحافظته (gov_<slug> = "1") + الأنواع التي فعّلها.
 *  الاشتراك (تحديث الـ tags على OneSignal) يتم فقط عبر الدالة
 *  updateNotificationSubscriptions.
 * ============================================================
 */

const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { onValueWritten } = require("firebase-functions/v2/database");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

const ONESIGNAL_REST_API_KEY = defineSecret("ONESIGNAL_REST_API_KEY");
const ONESIGNAL_APP_ID = "601cac8e-baf6-40d1-ba32-75fef5f02281";

initializeApp({
  databaseURL: "https://alwaeli-e5bf0-default-rtdb.asia-southeast1.firebasedatabase.app",
});
const db = getDatabase();

const REGION = "us-central1";
const TIMEZONE = "Asia/Baghdad";

// ---------------------------------------------------------------
// 18 محافظة عراقية بإحداثيات مركز كل محافظة
// ---------------------------------------------------------------
const GOVERNORATES = [
  { slug: "baghdad", name: "بغداد", lat: 33.3152, lng: 44.3661 },
  { slug: "basra", name: "البصرة", lat: 30.5085, lng: 47.7804 },
  { slug: "nineveh", name: "نينوى", lat: 36.3489, lng: 43.1189 },
  { slug: "erbil", name: "أربيل", lat: 36.1911, lng: 44.0092 },
  { slug: "sulaymaniyah", name: "السليمانية", lat: 35.5558, lng: 45.4351 },
  { slug: "duhok", name: "دهوك", lat: 36.8617, lng: 42.9891 },
  { slug: "kirkuk", name: "كركوك", lat: 35.4681, lng: 44.3922 },
  { slug: "najaf", name: "النجف الأشرف", lat: 31.9955, lng: 44.3283 },
  { slug: "karbala", name: "كربلاء المقدسة", lat: 32.6149, lng: 44.0246 },
  { slug: "babil", name: "بابل", lat: 32.4645, lng: 44.4162 },
  { slug: "wasit", name: "واسط", lat: 32.5122, lng: 45.8235 },
  { slug: "maysan", name: "ميسان", lat: 31.8353, lng: 47.1481 },
  { slug: "dhiqar", name: "ذي قار", lat: 31.0563, lng: 46.2585 },
  { slug: "muthanna", name: "المثنى", lat: 31.3234, lng: 45.2949 },
  { slug: "qadisiyyah", name: "القادسية", lat: 31.989, lng: 44.9199 },
  { slug: "anbar", name: "الأنبار", lat: 33.4207, lng: 43.3009 },
  { slug: "salahaldin", name: "صلاح الدين", lat: 34.6081, lng: 43.6779 },
  { slug: "diyala", name: "ديالى", lat: 33.7461, lng: 44.6434 },
];

const PRAYER_LABELS = {
  fajr: "الفجر",
  dhuhr: "الظهر والعصر",
  maghrib: "المغرب والعشاء",
};

const PREF_KEYS = ["newPost", "prayerTimes", "adhan", "dailyVerse"];

// ---------------------------------------------------------------
// أدوات تنسيق الوقت بتوقيت بغداد
// ---------------------------------------------------------------
function formatHHMM(date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDateKey(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(date); // YYYY-MM-DD
}

// ---------------------------------------------------------------
// حساب فلكي مباشر لمواقيت الصلاة (بدون أي حزمة خارجية)
// جعفرية 3 أوقات — زاوية الفجر 18°، المغرب 4°
// ---------------------------------------------------------------
const FAJR_ANGLE = 18;
const MAGHRIB_ANGLE = 4;

const dsin = (d) => Math.sin((d * Math.PI) / 180);
const dcos = (d) => Math.cos((d * Math.PI) / 180);
const darcsin = (x) => (Math.asin(x) * 180) / Math.PI;
const darccos = (x) => (Math.acos(x) * 180) / Math.PI;
const darctan2 = (y, x) => (Math.atan2(y, x) * 180) / Math.PI;
const fixAngle = (a) => { a = a % 360; return a < 0 ? a + 360 : a; };
const fixHour = (a) => { a = a % 24; return a < 0 ? a + 24 : a; };

function julianDate(y, m, d) {
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
}

function sunPosition(jd) {
  const D = jd - 2451545.0;
  const g = fixAngle(357.529 + 0.98560028 * D);
  const q = fixAngle(280.459 + 0.98564736 * D);
  const L = fixAngle(q + 1.915 * dsin(g) + 0.02 * dsin(2 * g));
  const e = 23.439 - 0.00000036 * D;
  const RA = darctan2(dcos(e) * dsin(L), dcos(L)) / 15;
  const eqt = q / 15 - fixHour(RA);
  const decl = darcsin(dsin(e) * dsin(L));
  return { decl, eqt };
}

function angleTime(angle, jd, lat, dhuhrUTC, before) {
  const { decl: D } = sunPosition(jd);
  const cosH = (-dsin(angle) - dsin(D) * dsin(lat)) / (dcos(D) * dcos(lat));
  const clamped = Math.max(-1, Math.min(1, cosH));
  const t = darccos(clamped) / 15;
  return fixHour(dhuhrUTC + (before ? -t : t));
}

function getPrayerTimes(lat, lng, date) {
  const jd = julianDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  const { eqt } = sunPosition(jd);
  const dhuhrUTC = fixHour(12 - lng / 15 - eqt);
  const fajrUTC = angleTime(FAJR_ANGLE, jd, lat, dhuhrUTC, true);
  const maghribUTC = angleTime(MAGHRIB_ANGLE, jd, lat, dhuhrUTC, false);

  const toDate = (hourUTC) => {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCMinutes(Math.round(hourUTC * 60));
    return d;
  };

  return { fajr: toDate(fajrUTC), dhuhr: toDate(dhuhrUTC), maghrib: toDate(maghribUTC) };
}

// =================================================================
// إرسال إشعار عبر OneSignal REST API حسب فلاتر tags
// =================================================================
async function sendOneSignalNotification(restApiKey, { title, body, filters, data }) {
  try {
    const res = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Basic ${restApiKey}`,
      },
      body: JSON.stringify({
        app_id: ONESIGNAL_APP_ID,
        headings: { en: title },
        contents: { en: body },
        filters,
        data: data || {},
        url: "https://hayiaa-alwaeli-app.onrender.com/",
      }),
    });
    const json = await res.json();
    if (json.errors) {
      console.error("فشل إرسال OneSignal:", JSON.stringify(json.errors));
    } else {
      console.log("نجح إرسال OneSignal — id:", json.id, "المستلمون:", json.recipients);
    }
    return json;
  } catch (err) {
    console.error("خطأ اتصال OneSignal:", err.message);
  }
}

// =================================================================
// 1) منشور جديد من الهيئة
// =================================================================
exports.onNewPost = onValueWritten(
  {
    ref: "/hayaa_posts",
    instance: "alwaeli-e5bf0-default-rtdb",
    region: "asia-southeast1",
    secrets: [ONESIGNAL_REST_API_KEY],
  },
  async (event) => {
    try {
      const beforeRaw = event.data.before.val();
      const afterRaw = event.data.after.val();
      if (!afterRaw) { console.log("onNewPost: لا يوجد محتوى بعد التغيير، تجاهل."); return; }

      const beforeArr = beforeRaw ? JSON.parse(beforeRaw) : [];
      const afterArr = JSON.parse(afterRaw);

      console.log(`onNewPost: قبل=${beforeArr.length} منشور، بعد=${afterArr.length} منشور.`);

      if (!Array.isArray(afterArr) || afterArr.length <= beforeArr.length) {
        console.log("onNewPost: العدد لم يزد (تعديل أو حذف)، لا إرسال.");
        return;
      }

      const newest = afterArr[0];
      const beforeIds = new Set(beforeArr.map((p) => p && p.id));
      if (!newest || beforeIds.has(newest.id)) {
        console.log("onNewPost: المنشور الأحدث موجود مسبقاً، لا إرسال.", newest && newest.id);
        return;
      }

      console.log("onNewPost: منشور جديد فعلي، جاري الإرسال:", newest.id, newest.title);

      const caption = (newest.title || newest.body || "اضغط لعرض المنشور الجديد")
        .toString()
        .slice(0, 120);

      await sendOneSignalNotification(ONESIGNAL_REST_API_KEY.value(), {
        title: "منشور جديد من الهيئة",
        body: caption,
        filters: [{ field: "tag", key: "pref_newPost", relation: "=", value: "1" }],
        data: { type: "newPost", postId: String(newest.id) },
      });
    } catch (err) {
      console.error("فشل معالجة منشور جديد:", err.message);
    }
  }
);

// =================================================================
// 2) و 3) تذكير مواقيت الصلاة + الأذان — دالة مجدولة كل دقيقة
// =================================================================
exports.checkPrayerTimes = onSchedule(
  { schedule: "every 1 minutes", timeZone: TIMEZONE, region: REGION, secrets: [ONESIGNAL_REST_API_KEY] },
  async () => {
    const restKey = ONESIGNAL_REST_API_KEY.value();
    const now = new Date();
    const nowStr = formatHHMM(now);
    const dateKey = formatDateKey(now);

    for (const gov of GOVERNORATES) {
      const times = getPrayerTimes(gov.lat, gov.lng, now);

      for (const [prayer, time] of Object.entries(times)) {
        if (formatHHMM(time) !== nowStr) continue;

        const sentRef = db.ref(`push_sent/${gov.slug}/${dateKey}/${prayer}`);
        const snap = await sentRef.once("value");
        if (snap.val()) continue; // أُرسل مسبقاً اليوم لهذا الوقت
        await sentRef.set(true);

        const label = PRAYER_LABELS[prayer];

        // إشعار تذكير نصي عادي
        await sendOneSignalNotification(restKey, {
          title: `حان الآن وقت صلاة ${label}`,
          body: `دخل وقت صلاة ${label} في ${gov.name}`,
          filters: [
            { field: "tag", key: `gov_${gov.slug}`, relation: "=", value: "1" },
            { field: "tag", key: "pref_prayerTimes", relation: "=", value: "1" },
          ],
          data: { type: "prayerTime", prayer, governorate: gov.slug },
        });

        // إشعار الأذان
        await sendOneSignalNotification(restKey, {
          title: `الله أكبر — حان وقت الأذان (${label})`,
          body: "اضغط للاستماع إلى الأذان",
          filters: [
            { field: "tag", key: `gov_${gov.slug}`, relation: "=", value: "1" },
            { field: "tag", key: "pref_adhan", relation: "=", value: "1" },
          ],
          data: { type: "adhan", prayer, governorate: gov.slug },
        });
      }
    }
  }
);

// =================================================================
// 4) آية / حكمة يومية — دالة مجدولة الساعة 7 صباحاً بغداد
// =================================================================
const FALLBACK_QUOTES = [
  "الصبر مفتاح الفرج",
  "من صبر ظفر",
  "خير الأعمال أدومها وإن قلّ",
  "بالشكر تدوم النعم",
];

exports.dailyQuote = onSchedule(
  { schedule: "0 7 * * *", timeZone: TIMEZONE, region: REGION, secrets: [ONESIGNAL_REST_API_KEY] },
  async () => {
    const snap = await db.ref("daily_quotes").once("value");
    let quotes = [];
    if (snap.exists()) quotes = Object.values(snap.val());
    if (!quotes.length) quotes = FALLBACK_QUOTES;

    const pick = quotes[Math.floor(Math.random() * quotes.length)];

    await sendOneSignalNotification(ONESIGNAL_REST_API_KEY.value(), {
      title: "حكمة اليوم",
      body: String(pick).slice(0, 150),
      filters: [{ field: "tag", key: "pref_dailyVerse", relation: "=", value: "1" }],
      data: { type: "dailyVerse" },
    });
  }
);

// =================================================================
// دالة الاشتراك — يستدعيها التطبيق عند تفعيل/تعديل تفضيلات الإشعارات
// تستقبل playerId (معرّف اشتراك OneSignal من المتصفح) بدل token الـ FCM
// =================================================================
exports.updateNotificationSubscriptions = onCall(
  { region: REGION, secrets: [ONESIGNAL_REST_API_KEY] },
  async (request) => {
    const { playerId, governorate, prefs } = request.data || {};
    if (!playerId) throw new HttpsError("invalid-argument", "playerId مفقود");

    const validGov = GOVERNORATES.some((g) => g.slug === governorate);
    if (governorate && !validGov) {
      throw new HttpsError("invalid-argument", "محافظة غير معروفة");
    }

    // ابنِ كائن tags: قيمة "1" للتفعيل، وقيمة فارغة "" لإلغاء التفعيل
    const tags = {};
    for (const gov of GOVERNORATES) {
      tags[`gov_${gov.slug}`] = gov.slug === governorate ? "1" : "";
    }
    for (const key of PREF_KEYS) {
      tags[`pref_${key}`] = prefs && prefs[key] ? "1" : "";
    }

    try {
      const res = await fetch(`https://onesignal.com/api/v1/players/${playerId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization: `Basic ${ONESIGNAL_REST_API_KEY.value()}`,
        },
        body: JSON.stringify({ app_id: ONESIGNAL_APP_ID, tags }),
      });
      const json = await res.json();
      console.log("نتيجة تحديث tags:", JSON.stringify(json));

      await db.ref(`push_tokens/${playerId}`).set({
        governorate: governorate || null,
        prefs: prefs || {},
        updatedAt: Date.now(),
      });

      return { success: true };
    } catch (err) {
      console.error("فشل تحديث OneSignal tags:", err.message);
      throw new HttpsError("internal", "فشل تحديث الاشتراك");
    }
  }
);
