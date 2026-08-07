/**
 * ============================================================
 *  dailyNotifications.js — الإشعارات اليومية المجدولة
 *  تطبيق هيئة الشيخ أحمد الوائلي
 * ============================================================
 *  دالة واحدة تعمل مرة كل يوم (00:30 بتوقيت بغداد) فتجدول
 *  إشعارات اليوم كله مسبقاً عند OneSignal.
 *
 *  لماذا عبر السيرفر؟ لأن إشعارات السيرفر تمر بخدمات جوجل
 *  التي لا تتوقف أبداً، بعكس المنبّهات المحلية التي يؤجّلها
 *  نظام توفير الطاقة في سامسونگ وشاومي.
 *
 *  جدول اليوم (7 إشعارات):
 *   1) بعد الفجر  +10 د  — آية اليوم (تُجلب من مصدر قرآني موثوق)
 *   2) 9:00 صباحاً       — حديث من أهل البيت عليهم السلام
 *   3) بعد الظهر  +10 د  — الصلاة على محمد وآل محمد
 *   4) 3:00 عصراً        — من فكر الشيخ أحمد الوائلي
 *   5) بعد المغرب +10 د  — من أذكار المساء وأدعيته
 *   6) 9:00 مساءً        — دعاء اليوم وزيارته (حسب اليوم)
 *   7) 11:00 مساءً       — فضل صلاة الليل والاستغفار بالسحر
 *
 *  وإن صادف اليوم مناسبة دينية، يُستبدل إشعار التاسعة صباحاً
 *  بإشعار المناسبة.
 * ============================================================
 */

const { getDatabase } = require("firebase-admin/database");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");

const ONESIGNAL_REST_API_KEY = defineSecret("ONESIGNAL_REST_API_KEY");
const ONESIGNAL_APP_ID = "601cac8e-baf6-40d1-ba32-75fef5f02281";

const TIMEZONE = "Asia/Baghdad";
const REGION = "us-central1";
const TZ_OFFSET = 3; // بغداد UTC+3 طوال السنة

/* ============================================================
   المحافظات — لحساب مواقيت كل منطقة على حدة
   ============================================================ */
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

/* ============================================================
   حساب مواقيت الصلاة — جعفرية، الفجر 18° والمغرب 4°
   ============================================================ */
const FAJR_ANGLE = 18;
const MAGHRIB_ANGLE = 4;

const dsin = (d) => Math.sin((d * Math.PI) / 180);
const dcos = (d) => Math.cos((d * Math.PI) / 180);
const darcsin = (x) => (Math.asin(x) * 180) / Math.PI;
const darccos = (x) => (Math.acos(x) * 180) / Math.PI;
const darctan2 = (y, x) => (Math.atan2(y, x) * 180) / Math.PI;
const fixAngle = (a) => { a %= 360; return a < 0 ? a + 360 : a; };
const fixHour = (a) => { a %= 24; return a < 0 ? a + 24 : a; };

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
  const t = darccos(Math.max(-1, Math.min(1, cosH))) / 15;
  return fixHour(dhuhrUTC + (before ? -t : t));
}

/* يعيد أوقات الفجر والظهر والمغرب ككائنات Date بتوقيت عالمي */
function getPrayerTimes(lat, lng, y, m, d) {
  const jd = julianDate(y, m, d);
  const { eqt } = sunPosition(jd);
  const dhuhrUTC = fixHour(12 - lng / 15 - eqt);
  const fajrUTC = angleTime(FAJR_ANGLE, jd, lat, dhuhrUTC, true);
  const maghribUTC = angleTime(MAGHRIB_ANGLE, jd, lat, dhuhrUTC, false);

  const mk = (hourUTC) => {
    const dt = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
    dt.setUTCMinutes(Math.round(hourUTC * 60));
    return dt;
  };
  return { fajr: mk(fajrUTC), dhuhr: mk(dhuhrUTC), maghrib: mk(maghribUTC) };
}

/* ============================================================
   المحتوى — يُراجَع ويُعدَّل بحرية
   ============================================================ */

const HADITH = [
  { t: "قال رسول الله ﷺ", b: "أفضل الناس أنفعهم للناس." },
  { t: "قال أمير المؤمنين عليه السلام", b: "قيمة كل امرئ ما يُحسنه." },
  { t: "قال الإمام الصادق عليه السلام", b: "من صدق لسانه زكا عمله." },
  { t: "قال الإمام علي عليه السلام", b: "لا غنى كالعقل، ولا فقر كالجهل، ولا ميراث كالأدب." },
  { t: "قال الإمام الحسين عليه السلام", b: "من حاول أمراً بمعصية الله كان أفوت لما يرجو وأسرع لمجيء ما يحذر." },
  { t: "قال الإمام الصادق عليه السلام", b: "كونوا دعاةً للناس بغير ألسنتكم." },
  { t: "قال الإمام زين العابدين عليه السلام", b: "من عمل بما افترض الله عليه فهو من خير الناس." },
  { t: "قال رسول الله ﷺ", b: "إنما بُعثت لأتمّم مكارم الأخلاق." },
  { t: "قال الإمام الباقر عليه السلام", b: "ما من عبادة أفضل من عفّة بطن وفرج." },
  { t: "قال أمير المؤمنين عليه السلام", b: "العلم خير من المال، العلم يحرسك وأنت تحرس المال." },
  { t: "قال الإمام الرضا عليه السلام", b: "التودّد إلى الناس نصف العقل." },
  { t: "قال الإمام الكاظم عليه السلام", b: "ليس منّا من لم يحاسب نفسه في كل يوم." },
  { t: "قال الإمام الصادق عليه السلام", b: "أحبّ إخواني إليّ من أهدى إليّ عيوبي." },
  { t: "قال رسول الله ﷺ", b: "الدالّ على الخير كفاعله." },
  { t: "قال الإمام الحسن عليه السلام", b: "من عرف الله أحبّه، ومن عرف الدنيا زهد فيها." },
];

const SALAWAT = [
  "قال رسول الله ﷺ: من صلّى عليّ صلاةً واحدة صلّى الله عليه عشراً. فأكثِر من الصلاة على محمد وآل محمد.",
  "الصلاة على محمد وآله تمحو الذنوب كما يمحو الماء النار — اللهم صلِّ على محمد وآل محمد.",
  "ما من دعاء إلا وبينه وبين السماء حجاب حتى يُصلّى على محمد وآل محمد.",
  "قال الإمام الصادق عليه السلام: من ذُكر عنده النبيّ ﷺ فلم يُصلِّ عليه فقد جفاه.",
  "أثقل ما يوضع في الميزان يوم القيامة الصلاة على محمد وآل محمد.",
  "اللهم صلِّ على محمد وآل محمد، وعجّل فرجهم، وأهلك عدوّهم.",
  "الصلاة على النبيّ وآله نورٌ في القلب وسعةٌ في الرزق وطمأنينةٌ في الصدر.",
  "قال أمير المؤمنين عليه السلام: الصلاة على النبيّ وآله أمحق للخطايا من الماء للنار.",
  "خذ من وقتك لحظة: اللهم صلِّ على محمد وآل محمد.",
  "من صلّى على محمد وآل محمد قضى الله له مئة حاجة.",
  "الصلاة على محمد وآله زكاة المجلس ونور الطريق.",
  "لا تنسَ الصلاة على النبيّ وآله عند كل ذكرٍ وكل دعاء.",
];

const EVENING = [
  "أَمْسَيْنا وأَمْسى المُلْكُ للهِ ربِّ العالَمين، اللهمّ إنّي أسألُكَ خيرَ هذه الليلة وخيرَ ما فيها.",
  "اللهمّ ما أمسى بي من نعمةٍ فمنك وحدك لا شريك لك، فلك الحمد ولك الشكر.",
  "أعوذُ بكلماتِ اللهِ التامّاتِ من شرِّ ما خلق — قُلْها ثلاثاً قبل نومك.",
  "اللهمّ اجعل آخر كلامي من الدنيا لا إله إلا الله محمد رسول الله.",
  "استغفر الله الذي لا إله إلا هو الحيّ القيّوم وأتوب إليه — سبعون مرة تُنقّي القلب.",
  "اللهمّ صلِّ على محمد وآل محمد، واغفر لي ما مضى من يومي.",
  "سبحان الله والحمد لله ولا إله إلا الله والله أكبر — أحبّ الكلام إلى الله.",
  "قال الإمام الصادق عليه السلام: من قرأ آية الكرسي عند منامه لم يخف شيئاً.",
  "اللهمّ إنّي أعوذ بك من زوال نعمتك وتحوّل عافيتك وفجاءة نقمتك.",
  "حاسِب نفسك قبل أن تنام: ماذا قدّمتَ اليوم لآخرتك؟",
  "اللهمّ اجعل ليلتي هذه راحةً لبدني ونوراً لقلبي.",
  "قبل نومك: سبّح ثلاثاً وثلاثين، واحمد ثلاثاً وثلاثين، وكبّر أربعاً وثلاثين — تسبيح الزهراء عليها السلام.",
];

const NIGHT_PRAYER = [
  "صلاة الليل شرف المؤمن — قال رسول الله ﷺ: عليكم بصلاة الليل فإنها دأب الصالحين قبلكم.",
  "قال الله تعالى في وصف عباده: كانوا قليلاً من الليل ما يهجعون، وبالأسحار هم يستغفرون.",
  "قال الإمام الصادق عليه السلام: ما من عملٍ حسنٍ يعمله العبد إلا وله ثوابٌ في القرآن، إلا صلاة الليل فإنّ الله لم يبيّن ثوابها لعِظَم خطرها عنده.",
  "ركعتان في جوف الليل أحبّ إليّ من الدنيا وما فيها.",
  "صلاة الليل تُبيّض الوجه، وتُذهب الهمّ، وتُوسّع الرزق.",
  "قال أمير المؤمنين عليه السلام: قيام الليل مصحّة للبدن ومرضاة للربّ.",
  "لا تنسَ الاستغفار في السحر — فإنّ الله يُنادي: هل من سائلٍ فأُعطيه؟",
  "من أراد أن يُحبّه الله فليقم في جوف الليل يناجيه.",
  "شرف المؤمن قيامه بالليل، وعزّه استغناؤه عن الناس.",
  "قال الإمام الباقر عليه السلام: إنّ الله يحبّ من عباده المؤمنين كلّ عبدٍ دعّاءٍ بالأسحار.",
  "ليلتك فرصة لا تتكرّر — قُم ولو بركعتين.",
  "الوتر في آخر الليل خيرٌ من الدنيا وما فيها.",
];

const WAELI = [
  "المنبر الحسيني مدرسة تربّي الوجدان قبل أن تخاطب العقل، وتزرع في النفس قيم الحق والعدل والتضحية.",
  "العلم نورٌ لا يُمنح إلا لمن طهّر قلبه وأخلص نيّته لله.",
  "الكلمة الصادقة تبقى، وإن مات صاحبها، لأنها تنبع من قلبٍ عرف الحق.",
  "قضية الحسين عليه السلام ليست حادثة في التاريخ، بل منهج حياة يتجدّد في كل زمان.",
  "الخطابة رسالة، ومن حملها فقد حمل أمانة الأنبياء في هداية الناس.",
  "لا تُقاس عظمة الإنسان بما يملك، بل بما يقدّمه لأمّته من خير.",
  "الوحدة بين المسلمين ليست شعاراً يُرفع، بل عملاً يُمارس في كل موقف.",
  "من لم يتعلّم من كربلاء معنى الإباء والكرامة، فقد قرأها ولم يفهمها.",
  "العقل نعمة، ولكنه لا يثمر إلا إذا اقترن بالإيمان والعمل الصالح.",
  "الصبر مفتاح الفرج، والمؤمن يرى في البلاء امتحاناً يرفعه لا محنةً تكسره.",
  "أعظم ما يورّثه الأب لأبنائه أخلاقٌ حسنة وعلمٌ نافع.",
  "الحق لا يعرفه إلا من جرّد نفسه من الهوى ووقف مع الدليل.",
  "المجتمع الذي يهمل شبابه يهمل مستقبله، والشباب أمانة في أعناقنا.",
  "الدين معاملة قبل أن يكون شعائر، وأخلاق قبل أن يكون مظاهر.",
  "من عرف قدر أهل البيت عليهم السلام عرف طريق النجاة.",
];

const FAJR_INTRO = [
  "تدبّر معنا آية اليوم",
  "آية اليوم — اقرأها بتأمّل",
  "ابدأ يومك بكلام الله",
  "من نور القرآن",
];

/* ============================================================
   أدوات
   ============================================================ */

/* تاريخ بغداد اليوم كأجزاء */
function baghdadToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()).split("-");
  return { y: +parts[0], m: +parts[1], d: +parts[2] };
}

/* اسم اليوم بالعربية */
function baghdadWeekday() {
  return new Intl.DateTimeFormat("ar", { timeZone: TIMEZONE, weekday: "long" })
    .format(new Date())
    .replace("يوم ", "")
    .trim();
}

/* التاريخ الهجري (لمطابقة المناسبات) */
function hijriToday() {
  try {
    const f = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", {
      timeZone: TIMEZONE, day: "numeric", month: "numeric",
    }).formatToParts(new Date());
    const get = (t) => +(f.find((p) => p.type === t) || {}).value;
    return { day: get("day"), month: get("month") };
  } catch (e) {
    return null;
  }
}

const HIJRI_MONTHS = ["محرم", "صفر", "ربيع الأول", "ربيع الثاني", "جمادى الأولى",
  "جمادى الآخرة", "رجب", "شعبان", "رمضان", "شوال", "ذو القعدة", "ذو الحجة"];

/* وقت ثابت بتوقيت بغداد -> Date عالمي */
function baghdadTime(y, m, d, hour, minute) {
  return new Date(Date.UTC(y, m - 1, d, hour - TZ_OFFSET, minute, 0, 0));
}

const dayIndex = (y, m, d) =>
  Math.floor(Date.UTC(y, m - 1, d) / 86400000);

const pick = (arr, i) => arr[((i % arr.length) + arr.length) % arr.length];

const trim = (s, n) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

/* ------------------------------------------------------------
   جلب آية اليوم من مصدر قرآني موثوق (النص العثماني)
   ------------------------------------------------------------ */
async function fetchAyah(idx) {
  const n = (Math.abs(idx) % 6236) + 1;
  try {
    const res = await fetch(`https://api.alquran.cloud/v1/ayah/${n}/quran-uthmani`);
    const json = await res.json();
    const d = json && json.data;
    if (!d || !d.text) return null;
    return {
      text: d.text,
      ref: `${d.surah.name} — الآية ${d.numberInSurah}`,
    };
  } catch (e) {
    console.error("تعذّر جلب الآية:", e.message);
    return null;
  }
}

/* ------------------------------------------------------------
   الإرسال عبر OneSignal بتوقيت مؤجّل
   ------------------------------------------------------------ */
async function schedule(restKey, { title, body, at, govSlug, data }) {
  const payload = {
    app_id: ONESIGNAL_APP_ID,
    headings: { en: title },
    contents: { en: body },
    send_after: at.toISOString(),
    data: data || {},
  };

  if (govSlug) {
    payload.filters = [{ field: "tag", key: "gov", relation: "=", value: govSlug }];
  } else {
    payload.included_segments = ["Total Subscriptions"];
  }

  try {
    const res = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Basic ${restKey}`,
      },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (json.errors) {
      console.error("فشل جدولة إشعار:", title, JSON.stringify(json.errors));
    }
    return json;
  } catch (e) {
    console.error("خطأ اتصال OneSignal:", e.message);
  }
}

/* ============================================================
   الدالة المجدولة — كل يوم 00:30 بتوقيت بغداد
   ============================================================ */
exports.scheduleDailyNotifications = onSchedule(
  {
    schedule: "30 0 * * *",
    timeZone: TIMEZONE,
    region: REGION,
    secrets: [ONESIGNAL_REST_API_KEY],
    timeoutSeconds: 540,
    memory: "256MiB",
  },
  async () => {
    const restKey = ONESIGNAL_REST_API_KEY.value();
    const db = getDatabase();

    const { y, m, d } = baghdadToday();
    const idx = dayIndex(y, m, d);
    const weekday = baghdadWeekday();

    console.log(`جدولة إشعارات ${y}-${m}-${d} (${weekday})`);

    /* ---------- 1) آية اليوم ---------- */
    const ayah = await fetchAyah(idx * 7);

    /* ---------- 2) دعاء اليوم من قاعدة البيانات ---------- */
    let todayDua = null;
    try {
      const snap = await db.ref("hayaa_weekday_ziyarat").once("value");
      const raw = snap.val();
      const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (Array.isArray(arr)) {
        todayDua = arr.find((x) => x && x.day === weekday) || null;
      }
    } catch (e) {
      console.error("تعذّر قراءة زيارات الأيام:", e.message);
    }

    /* ---------- 3) مناسبة اليوم ---------- */
    let occasion = null;
    const hij = hijriToday();
    if (hij) {
      try {
        const snap = await db.ref("hayaa_occasions").once("value");
        const raw = snap.val();
        const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
        const monthName = HIJRI_MONTHS[hij.month - 1];
        if (Array.isArray(arr)) {
          occasion = arr.find((o) => o && o.m === monthName && +o.d === hij.day) || null;
        }
      } catch (e) {
        console.error("تعذّر قراءة المناسبات:", e.message);
      }
    }

    /* ---------- الإشعارات ذات التوقيت الثابت ---------- */
    const fixed = [];

    // 9:00 صباحاً — حديث، أو المناسبة إن وُجدت
    if (occasion) {
      fixed.push({
        at: baghdadTime(y, m, d, 9, 0),
        title: "مناسبة اليوم",
        body: trim(occasion.t, 170),
        data: { type: "occasion" },
      });
    } else {
      const h = pick(HADITH, idx);
      fixed.push({
        at: baghdadTime(y, m, d, 9, 0),
        title: h.t,
        body: trim(h.b, 170),
        data: { type: "hadith" },
      });
    }

    // 3:00 عصراً — من فكر الشيخ الوائلي
    fixed.push({
      at: baghdadTime(y, m, d, 15, 0),
      title: "من فكر الشيخ أحمد الوائلي",
      body: trim(pick(WAELI, idx), 170),
      data: { type: "quote" },
    });

    // 9:00 مساءً — دعاء اليوم وزيارته
    if (todayDua) {
      fixed.push({
        at: baghdadTime(y, m, d, 21, 0),
        title: `دعاء اليوم — ${weekday}`,
        body: trim(todayDua.who || "زيارة اليوم ودعاؤه بانتظارك في التطبيق", 170),
        data: { type: "weekdayDua", day: weekday },
      });
    }

    // 11:00 مساءً — فضل صلاة الليل
    fixed.push({
      at: baghdadTime(y, m, d, 23, 0),
      title: "صلاة الليل",
      body: trim(pick(NIGHT_PRAYER, idx), 170),
      data: { type: "nightPrayer" },
    });

    for (const n of fixed) {
      await schedule(restKey, { ...n, govSlug: null });
    }
    console.log(`جُدولت ${fixed.length} إشعارات بتوقيت ثابت.`);

    /* ---------- الإشعارات المرتبطة بالصلاة (لكل محافظة) ---------- */
    const ayahBody = ayah
      ? trim(`${ayah.text}\n${ayah.ref}`, 300)
      : "افتح المصحف في التطبيق واقرأ وردك لهذا اليوم.";
    const ayahTitle = pick(FAJR_INTRO, idx);
    const salawat = trim(pick(SALAWAT, idx), 170);

    let count = 0;
    for (const gov of GOVERNORATES) {
      const t = getPrayerTimes(gov.lat, gov.lng, y, m, d);
      const plus10 = (dt) => new Date(dt.getTime() + 10 * 60000);

      const items = [
        { at: plus10(t.fajr), title: ayahTitle, body: ayahBody, data: { type: "ayah" } },
        { at: plus10(t.dhuhr), title: "الصلاة على محمد وآل محمد", body: salawat, data: { type: "salawat" } },
        { at: plus10(t.maghrib), title: "من أذكار المساء", body: trim(pick(EVENING, idx), 170), data: { type: "evening" } },
      ];

      for (const it of items) {
        if (it.at.getTime() <= Date.now() + 60000) continue; // فات وقته
        await schedule(restKey, { ...it, govSlug: gov.slug });
        count++;
      }
    }

    console.log(`جُدولت ${count} إشعارات مرتبطة بالصلاة عبر ${GOVERNORATES.length} محافظة.`);
  }
);
