/**
 * ============================================================
 *  إشعارات تطبيق هيئة الشيخ أحمد الوائلي — Cloud Functions
 * ============================================================
 *  الدوال الحالية:
 *   1) onNewPost            -> إشعار عند نزول منشور جديد
 *   2) fetchInstagramPosts  -> سحب منشورات إنستغرام كل ساعة
 *   3) refreshInstagramToken-> تجديد رمز الوصول شهرياً
 *
 *  لماذا حُذف الباقي سابقاً؟
 *   - الأذان ومواقيت الصلاة  -> صارت تُجدول محلياً داخل الهاتف
 *   - الحكمة اليومية         -> صارت ضمن التذكيرات المحلية
 *   - updateNotificationSubscriptions -> كان يخدم صف الإعدادات الملغى
 * ============================================================
 */

const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { getStorage } = require("firebase-admin/storage");
const { onValueWritten } = require("firebase-functions/v2/database");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const crypto = require("crypto");

const ONESIGNAL_REST_API_KEY = defineSecret("ONESIGNAL_REST_API_KEY");
const ONESIGNAL_APP_ID = "601cac8e-baf6-40d1-ba32-75fef5f02281";

const DB_URL =
  "https://alwaeli-e5bf0-default-rtdb.asia-southeast1.firebasedatabase.app";
const STORAGE_BUCKET = "alwaeli-e5bf0.firebasestorage.app";
const REGION = "asia-southeast1";
const DB_INSTANCE = "alwaeli-e5bf0-default-rtdb";

// معرّف حساب إنستغرام للهيئة (ليس سرّاً)
const IG_USER_ID = "17841476812685717";

// أقصى عدد صور/فيديوهات نسحبها من المنشور الواحد
const MAX_MEDIA_PER_POST = 10;

initializeApp({
  databaseURL: DB_URL,
  storageBucket: STORAGE_BUCKET,
});

// =================================================================
// إرسال إشعار عبر OneSignal لكل المشتركين
// =================================================================
async function sendToAll(restApiKey, { title, body, data }) {
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
        included_segments: ["Total Subscriptions"],
        data: data || {},
      }),
    });

    const json = await res.json();
    if (json.errors) {
      console.error("فشل إرسال OneSignal:", JSON.stringify(json.errors));
    } else {
      console.log("نجح الإرسال — id:", json.id, "المستلمون:", json.recipients);
    }
    return json;
  } catch (err) {
    console.error("خطأ اتصال OneSignal:", err.message);
  }
}

// =================================================================
// منشور جديد من الهيئة
// =================================================================
exports.onNewPost = onValueWritten(
  {
    ref: "/hayaa_posts",
    instance: DB_INSTANCE,
    region: REGION,
    secrets: [ONESIGNAL_REST_API_KEY],
  },
  async (event) => {
    try {
      const beforeRaw = event.data.before.val();
      const afterRaw = event.data.after.val();
      if (!afterRaw) {
        console.log("onNewPost: لا يوجد محتوى بعد التغيير، تجاهل.");
        return;
      }

      const beforeArr = beforeRaw ? JSON.parse(beforeRaw) : [];
      const afterArr = JSON.parse(afterRaw);

      console.log(
        `onNewPost: قبل=${beforeArr.length} منشور، بعد=${afterArr.length} منشور.`
      );

      if (!Array.isArray(afterArr) || afterArr.length <= beforeArr.length) {
        console.log("onNewPost: العدد لم يزد (تعديل أو حذف)، لا إرسال.");
        return;
      }

      const newest = afterArr[0];
      const beforeIds = new Set(beforeArr.map((p) => p && p.id));
      if (!newest || beforeIds.has(newest.id)) {
        console.log("onNewPost: المنشور الأحدث موجود مسبقاً، لا إرسال.");
        return;
      }

      console.log("onNewPost: منشور جديد فعلي:", newest.id, newest.title);

      // نُفضّل نص المنشور على العنوان، لأن عنوان المنشورات المسحوبة
      // من إنستغرام ثابت وسيتكرر مع عنوان الإشعار نفسه
      const caption = (newest.body || newest.title || "اضغط لعرض المنشور الجديد")
        .toString()
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);

      await sendToAll(ONESIGNAL_REST_API_KEY.value(), {
        title: "منشور جديد من الهيئة",
        body: caption,
        data: { type: "newPost", postId: String(newest.id) },
      });
    } catch (err) {
      console.error("فشل معالجة منشور جديد:", err.message);
    }
  }
);

// =================================================================
//  أدوات مساعدة لمزامنة إنستغرام
// =================================================================

const AR_MONTHS = [
  "كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران",
  "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول",
];

/** تحويل الأرقام إلى هندية: 21 -> ٢١ */
function toArabicDigits(n) {
  return String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
}

/** صياغة التاريخ بتوقيت بغداد: "٢١ تموز" */
function formatArabicDate(date) {
  const baghdad = new Date(date.getTime() + 3 * 60 * 60 * 1000); // UTC+3 بلا توقيت صيفي
  return `${toArabicDigits(baghdad.getUTCDate())} ${AR_MONTHS[baghdad.getUTCMonth()]}`;
}

/** قراءة رمز الوصول المخزَّن في قاعدة البيانات */
async function getToken() {
  const snap = await getDatabase().ref("/ig_sync/token").get();
  const token = snap.val();
  if (!token) throw new Error("لا يوجد رمز وصول مخزَّن في /ig_sync/token");
  return token;
}

/** تنزيل ملف من إنستغرام ورفعه إلى Firebase Storage بنفس صيغة الروابط الحالية */
async function mirrorMedia(mediaUrl, isVideo, igId) {
  const res = await fetch(mediaUrl);
  if (!res.ok) throw new Error(`فشل تنزيل الميديا: ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = isVideo ? "mp4" : "jpg";
  const contentType = isVideo ? "video/mp4" : "image/jpeg";
  const mediaPath = `posts/${Date.now()}_ig_${igId}.${ext}`;
  const downloadToken = crypto.randomUUID();

  const file = getStorage().bucket().file(mediaPath);
  await file.save(buffer, {
    metadata: {
      contentType,
      metadata: { firebaseStorageDownloadTokens: downloadToken },
    },
  });

  const media =
    `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/` +
    `${encodeURIComponent(mediaPath)}?alt=media&token=${downloadToken}`;

  console.log(`رُفعت الميديا (${Math.round(buffer.length / 1024)} كب): ${mediaPath}`);
  return { media, mediaPath };
}

/**
 * استخراج كل عناصر الميديا في المنشور.
 * يعيد مصفوفة [{ url, isVideo }] — عنصر واحد للصورة أو الفيديو المفرد،
 * وكل العناصر للمنشور متعدد الصور (الكاروسيل).
 *
 * يعالج ثلاث حالات كانت تُسقط المنشور سابقاً:
 *   - الكاروسيل: لا رابط في الأصل، والعناصر تأتي ضمن children
 *   - الفيديو قيد المعالجة عند إنستغرام: media_url يرجع فارغاً مؤقتاً
 *   - الريلز: أحياناً ترجع بـ thumbnail_url فقط
 */
async function resolveAllMedia(item, token) {
  const out = [];

  // --- الكاروسيل: نأخذ كل العناصر بالترتيب ---
  if (item.media_type === "CAROUSEL_ALBUM") {
    let kids = (item.children && item.children.data) || null;

    if (!kids) {
      try {
        const url =
          `https://graph.instagram.com/v23.0/${item.id}/children` +
          `?fields=id,media_type,media_url,thumbnail_url&access_token=${token}`;
        const res = await fetch(url);
        const json = await res.json();
        kids = json.data || null;
      } catch (err) {
        console.error(`تعذّر جلب عناصر الكاروسيل ${item.id}:`, err.message);
      }
    }

    if (kids && kids.length) {
      for (const kid of kids.slice(0, MAX_MEDIA_PER_POST)) {
        if (kid.media_url) {
          out.push({ url: kid.media_url, isVideo: kid.media_type === "VIDEO" });
        } else if (kid.thumbnail_url) {
          out.push({ url: kid.thumbnail_url, isVideo: false });
        }
      }
    }
    return out;
  }

  // --- صورة أو فيديو مفرد ---
  if (item.media_url) {
    out.push({ url: item.media_url, isVideo: item.media_type === "VIDEO" });
    return out;
  }

  // فيديو بلا رابط بعد: نستعمل الصورة المصغّرة بدل إسقاط المنشور
  if (item.thumbnail_url) {
    console.log(`${item.id}: لا يوجد media_url، استُعملت الصورة المصغّرة.`);
    out.push({ url: item.thumbnail_url, isVideo: false });
  }

  return out;
}

// =================================================================
// سحب منشورات إنستغرام — كل ساعة
// =================================================================
exports.fetchInstagramPosts = onSchedule(
  {
    schedule: "every 60 minutes",
    timeZone: "Asia/Baghdad",
    region: REGION,
    memory: "512MiB",
    timeoutSeconds: 540,
    retryCount: 0,
  },
  async () => {
    const db = getDatabase();

    let token;
    try {
      token = await getToken();
    } catch (err) {
      console.error("fetchInstagramPosts:", err.message);
      return;
    }

    // 1) جلب آخر المنشورات من إنستغرام
    const fields =
      "id,caption,media_type,media_product_type,media_url,thumbnail_url," +
      "permalink,timestamp,children{id,media_type,media_url,thumbnail_url}";
    const url =
      `https://graph.instagram.com/v23.0/${IG_USER_ID}/media` +
      `?fields=${encodeURIComponent(fields)}&limit=10&access_token=${token}`;

    let items;
    try {
      const res = await fetch(url);
      const json = await res.json();
      if (json.error) {
        console.error("خطأ من إنستغرام:", JSON.stringify(json.error));
        return;
      }
      items = json.data || [];
    } catch (err) {
      console.error("فشل الاتصال بإنستغرام:", err.message);
      return;
    }

    if (!items.length) {
      console.log("لا توجد منشورات في الحساب.");
      return;
    }

    // 2) التفعيل الأول: نعلّم كل الموجود كـ«مسحوب» بلا استيراد
    const seenSnap = await db.ref("/ig_sync/seen").get();
    const seen = seenSnap.val() || {};
    const activatedSnap = await db.ref("/ig_sync/activated_at").get();

    if (!activatedSnap.exists()) {
      const initial = {};
      for (const it of items) initial[it.id] = true;
      await db.ref("/ig_sync").update({
        activated_at: Date.now(),
        seen: initial,
      });
      console.log(
        `التفعيل الأول: عُلّم ${items.length} منشوراً كمقروء بلا استيراد. ` +
          `المنشورات الجديدة فقط ستُسحب من الآن.`
      );
      return;
    }

    // 3) تحديد الجديد (الأقدم أولاً حتى يبقى الترتيب صحيحاً)
    const fresh = items.filter((it) => !seen[it.id]).reverse();
    if (!fresh.length) {
      console.log("لا يوجد جديد.");
      return;
    }
    console.log(`وُجد ${fresh.length} منشوراً جديداً.`);

    // 4) قراءة المنشورات الحالية (مخزَّنة كنص JSON)
    const postsSnap = await db.ref("/hayaa_posts").get();
    const raw = postsSnap.val();
    let posts = [];
    try {
      posts = raw ? JSON.parse(raw) : [];
    } catch (err) {
      console.error("تعذّر قراءة hayaa_posts، إيقاف احترازي:", err.message);
      return;
    }
    if (!Array.isArray(posts)) {
      console.error("hayaa_posts ليست مصفوفة، إيقاف احترازي.");
      return;
    }

    // 5) تحويل كل منشور جديد ورفع ميديته
    const attemptsSnap = await db.ref("/ig_sync/attempts").get();
    const attempts = attemptsSnap.val() || {};
    const attemptUpdates = {};

    const seenUpdates = {};
    let added = 0;

    for (const item of fresh) {
      try {
        const resolvedList = await resolveAllMedia(item, token);
        if (!resolvedList.length) {
          const n = (attempts[item.id] || 0) + 1;
          attemptUpdates[item.id] = n;

          // نطبع تفاصيل المنشور لتشخيص السبب بدقة
          console.log(
            `${item.id}: لا توجد ميديا صالحة (محاولة ${n}/5) — ` +
              JSON.stringify({
                media_type: item.media_type,
                media_product_type: item.media_product_type,
                has_media_url: !!item.media_url,
                has_thumbnail: !!item.thumbnail_url,
                children: item.children ? (item.children.data || []).length : 0,
              })
          );

          // نعلّمه كمقروء فقط بعد خمس محاولات فاشلة، وإلا نعيد المحاولة
          // في الدورة القادمة (الفيديو قد يكون قيد المعالجة عند إنستغرام)
          if (n >= 5) {
            console.log(`${item.id}: استُنفدت المحاولات، تخطٍّ نهائي.`);
            seenUpdates[item.id] = true;
          }
          continue;
        }

        // نرفع كل عناصر المنشور بالترتيب
        const mediaItems = [];
        for (let i = 0; i < resolvedList.length; i++) {
          const r = resolvedList[i];
          const { media, mediaPath } = await mirrorMedia(
            r.url,
            r.isVideo,
            `${item.id}_${i}`
          );
          mediaItems.push({
            url: media,
            type: r.isVideo ? "video" : "image",
            path: mediaPath,
          });
        }

        posts.unshift({
          id: String(Date.now() + added),
          title: "منشور جديد من الهيئة",
          body: (item.caption || "").trim(),
          // الحقول المفردة تبقى للتوافق مع المنشورات القديمة والتطبيقات غير المحدَّثة
          media: mediaItems[0].url,
          mediaType: mediaItems[0].type,
          mediaPath: mediaItems[0].path,
          mediaItems,
          date: formatArabicDate(new Date(item.timestamp)),
        });

        if (mediaItems.length > 1) {
          console.log(`${item.id}: منشور متعدد — ${mediaItems.length} عنصراً.`);
        }

        seenUpdates[item.id] = true;
        added++;
        console.log(`أُضيف منشور إنستغرام ${item.id}`);
      } catch (err) {
        // لا نعلّمه كمسحوب حتى تُعاد المحاولة بالدورة القادمة
        console.error(`فشل معالجة ${item.id}:`, err.message);
      }
    }

    if (Object.keys(attemptUpdates).length) {
      await db.ref("/ig_sync/attempts").update(attemptUpdates);
    }

    if (!added) {
      if (Object.keys(seenUpdates).length) {
        await db.ref("/ig_sync/seen").update(seenUpdates);
      }
      console.log("لم يُضَف أي منشور.");
      return;
    }

    // 6) كتابة واحدة -> onNewPost يطلق إشعاراً واحداً
    await db.ref("/hayaa_posts").set(JSON.stringify(posts));
    await db.ref("/ig_sync/seen").update(seenUpdates);
    await db.ref("/ig_sync/last_run").set(Date.now());

    console.log(`تمت المزامنة: ${added} منشور. المجموع الآن ${posts.length}.`);
  }
);

// =================================================================
// تجديد رمز الوصول — كل 30 يوماً
// =================================================================
exports.refreshInstagramToken = onSchedule(
  {
    schedule: "0 3 1 * *", // الساعة 3 فجراً من أول كل شهر
    timeZone: "Asia/Baghdad",
    region: REGION,
    retryCount: 1,
  },
  async () => {
    const db = getDatabase();

    let token;
    try {
      token = await getToken();
    } catch (err) {
      console.error("refreshInstagramToken:", err.message);
      return;
    }

    try {
      const url =
        "https://graph.instagram.com/refresh_access_token" +
        `?grant_type=ig_refresh_token&access_token=${token}`;
      const res = await fetch(url);
      const json = await res.json();

      if (json.error || !json.access_token) {
        console.error("فشل التجديد:", JSON.stringify(json.error || json));
        return;
      }

      await db.ref("/ig_sync").update({
        token: json.access_token,
        token_refreshed_at: Date.now(),
        token_expires_in_days: Math.round((json.expires_in || 0) / 86400),
      });

      console.log(
        `جُدّد الرمز بنجاح — صالح ${Math.round((json.expires_in || 0) / 86400)} يوماً.`
      );
    } catch (err) {
      console.error("خطأ اتصال أثناء التجديد:", err.message);
    }
  }
);
// ===== الإشعارات اليومية المجدولة =====
exports.scheduleDailyNotifications =
  require("./dailyNotifications").scheduleDailyNotifications;