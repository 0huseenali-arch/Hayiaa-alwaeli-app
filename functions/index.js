/**
 * ============================================================
 *  إشعارات تطبيق هيئة الشيخ أحمد الوائلي — Cloud Functions
 * ============================================================
 *  4 أنواع إشعارات:
 *   1) منشور جديد من الهيئة       -> topic: pref_newPost
 *   2) تذكير مواقيت الصلاة        -> topic: pref_prayerTimes
 *   3) أذان عند دخول الوقت        -> topic: pref_adhan
 *   4) آية / حكمة يومية           -> topic: pref_dailyVerse
 *
 *  كل مستخدم مشترك بـ topic محافظته (gov_<slug>) + الأنواع التي فعّلها.
 *  الاشتراك يتم فقط عبر الدالة updateNotificationSubscriptions
 *  (السيرفر وحده يملك صلاحية الاشتراك بالمواضيع).
 * ============================================================
 */

const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { getMessaging } = require("firebase-admin/messaging");
const { onValueCreated } = require("firebase-functions/v2/database");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const adhan = require("adhan");

initializeApp();
const db = getDatabase();
const messaging = getMessaging();

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

// جعفرية 3 أوقات: نعتمد طريقة "طهران" التقريبية (الأقرب للحساب الجعفري
// المعتمد في مواقيت الصلاة الشيعية) لحساب الفجر/الظهر/المغرب فقط.
function getPrayerTimes(lat, lng, date) {
  const coordinates = new adhan.Coordinates(lat, lng);
  const params = adhan.CalculationMethod.Tehran();
  const pt = new adhan.PrayerTimes(coordinates, date, params);
  return { fajr: pt.fajr, dhuhr: pt.dhuhr, maghrib: pt.maghrib };
}

// إرسال إلى شرط (محافظة + نوع تفضيل) مع تقسيم لتفادي أخطاء الإرسال
async function sendToCondition(condition, notification, data) {
  try {
    await messaging.send({
      condition,
      notification,
      data: data || {},
      webpush: {
        fcmOptions: { link: "https://hayiaa-alwaeli-app.onrender.com/" },
      },
    });
  } catch (err) {
    console.error(`فشل الإرسال للشرط: ${condition}`, err.message);
  }
}

// =================================================================
// 1) منشور جديد من الهيئة
//    ملاحظة مهمة: افترضت أن المنشورات تُخزن على المسار /posts/{id}
//    — تأكد من هذا المسار في firebase.js / App.jsx وعدّله هنا إذا اختلف
// =================================================================
exports.onNewPost = onValueCreated(
  { ref: "/posts/{postId}", region: REGION },
  async (event) => {
    const post = event.data.val() || {};
    const caption = (post.caption || post.text || "اضغط لعرض المنشور الجديد")
      .toString()
      .slice(0, 120);

    await sendToCondition(
      "'pref_newPost' in topics",
      { title: "منشور جديد من الهيئة", body: caption },
      { type: "newPost", postId: event.params.postId }
    );
  }
);

// =================================================================
// 2) و 3) تذكير مواقيت الصلاة + الأذان — دالة مجدولة كل دقيقة
// =================================================================
exports.checkPrayerTimes = onSchedule(
  { schedule: "every 1 minutes", timeZone: TIMEZONE, region: REGION },
  async () => {
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
        await sendToCondition(
          `'gov_${gov.slug}' in topics && 'pref_prayerTimes' in topics`,
          {
            title: `حان الآن وقت صلاة ${label}`,
            body: `دخل وقت صلاة ${label} في ${gov.name}`,
          },
          { type: "prayerTime", prayer, governorate: gov.slug }
        );

        // إشعار الأذان (يفتح صوت الأذان داخل التطبيق عند الاستلام/الضغط)
        await sendToCondition(
          `'gov_${gov.slug}' in topics && 'pref_adhan' in topics`,
          {
            title: `الله أكبر — حان وقت الأذان (${label})`,
            body: "اضغط للاستماع إلى الأذان",
          },
          { type: "adhan", prayer, governorate: gov.slug }
        );
      }
    }
  }
);

// =================================================================
// 4) آية / حكمة يومية — دالة مجدولة مرة كل يوم الساعة 7 صباحاً بغداد
//    المصدر: /daily_quotes في Realtime Database (تُدار من لوحة التحكم
//    لاحقاً)، وإن كانت فارغة يُستخدم مصدر احتياطي بسيط.
// =================================================================
const FALLBACK_QUOTES = [
  "الصبر مفتاح الفرج",
  "من صبر ظفر",
  "خير الأعمال أدومها وإن قلّ",
  "بالشكر تدوم النعم",
];

exports.dailyQuote = onSchedule(
  { schedule: "0 7 * * *", timeZone: TIMEZONE, region: REGION },
  async () => {
    const snap = await db.ref("daily_quotes").once("value");
    let quotes = [];
    if (snap.exists()) quotes = Object.values(snap.val());
    if (!quotes.length) quotes = FALLBACK_QUOTES;

    const pick = quotes[Math.floor(Math.random() * quotes.length)];

    await sendToCondition(
      "'pref_dailyVerse' in topics",
      { title: "حكمة اليوم", body: String(pick).slice(0, 150) },
      { type: "dailyVerse" }
    );
  }
);

// =================================================================
// دالة الاشتراك — يستدعيها التطبيق عند تفعيل/تعديل تفضيلات الإشعارات
// =================================================================
const PREF_KEYS = ["newPost", "prayerTimes", "adhan", "dailyVerse"];

exports.updateNotificationSubscriptions = onCall(
  { region: REGION },
  async (request) => {
    const { token, governorate, prefs } = request.data || {};
    if (!token) throw new HttpsError("invalid-argument", "token مفقود");

    const validGov = GOVERNORATES.some((g) => g.slug === governorate);
    if (governorate && !validGov) {
      throw new HttpsError("invalid-argument", "محافظة غير معروفة");
    }

    // محافظة واحدة فقط مفعّلة بأي وقت
    for (const gov of GOVERNORATES) {
      const topic = `gov_${gov.slug}`;
      if (gov.slug === governorate) {
        await messaging.subscribeToTopic(token, topic).catch(() => {});
      } else {
        await messaging.unsubscribeFromTopic(token, topic).catch(() => {});
      }
    }

    for (const key of PREF_KEYS) {
      const topic = `pref_${key}`;
      if (prefs && prefs[key]) {
        await messaging.subscribeToTopic(token, topic).catch(() => {});
      } else {
        await messaging.unsubscribeFromTopic(token, topic).catch(() => {});
      }
    }

    await db.ref(`push_tokens/${token}`).set({
      governorate: governorate || null,
      prefs: prefs || {},
      updatedAt: Date.now(),
    });

    return { success: true };
  }
);
