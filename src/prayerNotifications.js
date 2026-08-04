// ============================================================
//  prayerNotifications.js — كل الإشعارات المجدولة على الجهاز
//
//  (1) الأذان عند دخول وقت الصلاة  — مشروط بزر الأذان في الإعدادات
//  (2) تذكير كل 6 ساعات بالمكتبة/القرآن أو اقتباس — يعمل دائماً
//
//  كلاهما يُجدولان داخل الهاتف نفسه، فيعملان والتطبيق مسكّر
//  والشاشة مطفية وبدون إنترنت.
//
//  لا يعمل شيء منه داخل المتصفح.
// ============================================================

import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { Geolocation } from '@capacitor/geolocation'

const CH_ADHAN = 'adhan'

const ADHAN_DAYS = 30       // كم يوماً نجدول الأذان مسبقاً
const REMIND_DAYS = 14      // كم يوماً نجدول التذكيرات مسبقاً

// أوقات التذكير (كل 6 ساعات ضمن ساعات اليقظة — تخطّينا تذكير الثالثة فجراً عمداً)
const REMIND_HOURS = [9, 15, 21]

const KEY_COORDS = 'hayaa_last_coords'
const KEY_STAMP = 'hayaa_sched_at'
const KEY_ADHAN = 'hayaa_adhan'

const PRAYERS = [
  ['Fajr', 'الفجر'],
  ['Dhuhr', 'الظهر'],
  ['Maghrib', 'المغرب'],
]

/* ---------------- محتوى التذكيرات ---------------- */

const QUOTES = [
  'المنبر الحسيني مدرسة تربّي الوجدان قبل أن تخاطب العقل، وتزرع في النفس قيم الحق والعدل والتضحية.',
  'العلم نورٌ لا يُمنح إلا لمن طهّر قلبه وأخلص نيّته لله.',
  'الكلمة الصادقة تبقى، وإن مات صاحبها، لأنها تنبع من قلبٍ عرف الحق.',
  'قضية الحسين عليه السلام ليست حادثة في التاريخ، بل منهج حياة يتجدّد في كل زمان.',
  'الخطابة رسالة، ومن حملها فقد حمل أمانة الأنبياء في هداية الناس.',
  'لا تُقاس عظمة الإنسان بما يملك، بل بما يقدّمه لأمّته من خير.',
  'الوحدة بين المسلمين ليست شعاراً يُرفع، بل عملاً يُمارس في كل موقف.',
  'من لم يتعلّم من كربلاء معنى الإباء والكرامة، فقد قرأها ولم يفهمها.',
  'العقل نعمة، ولكنه لا يثمر إلا إذا اقترن بالإيمان والعمل الصالح.',
  'الصبر مفتاح الفرج، والمؤمن يرى في البلاء امتحاناً يرفعه لا محنةً تكسره.',
  'أعظم ما يورّثه الأب لأبنائه أخلاقٌ حسنة وعلمٌ نافع.',
  'الحق لا يعرفه إلا من جرّد نفسه من الهوى ووقف مع الدليل.',
  'المجتمع الذي يهمل شبابه يهمل مستقبله، والشباب أمانة في أعناقنا.',
  'الدين معاملة قبل أن يكون شعائر، وأخلاق قبل أن يكون مظاهر.',
  'من عرف قدر أهل البيت عليهم السلام عرف طريق النجاة.',
]

const NUDGES = [
  { title: 'القرآن الكريم', body: 'ورد اليوم بانتظارك — افتح المصحف واقرأ ولو آيات.' },
  { title: 'المكتبة الدينية', body: 'كتب ونصوص أهل البيت عليهم السلام بانتظارك في المكتبة.' },
  { title: 'مفاتيح الجنان', body: 'دعاء أو زيارة تُقرّبك — افتح مفاتيح الجنان.' },
  { title: 'زيارة عاشوراء', body: 'لا تجعل يومك يمرّ بلا سلام على أبي عبد الله عليه السلام.' },
  { title: 'المكتبة الدينية', body: 'صفحة واحدة كل يوم تبني عمراً من المعرفة.' },
  { title: 'القرآن الكريم', body: 'اجعل للقرآن نصيباً من يومك ولو سورة قصيرة.' },
]

/* يبني قائمة متناوبة: تذكير ثم اقتباس ثم تذكير... */
function reminderAt(index) {
  if (index % 2 === 0) {
    return NUDGES[Math.floor(index / 2) % NUDGES.length]
  }
  return {
    title: 'من فكر الشيخ أحمد الوائلي',
    body: QUOTES[Math.floor(index / 2) % QUOTES.length],
  }
}

/* ---------------- أدوات ---------------- */

const isAdhanEnabled = () => {
  try { return localStorage.getItem(KEY_ADHAN) === '1' } catch (e) { return false }
}
const readJSON = (k) => {
  try { return JSON.parse(localStorage.getItem(k) || 'null') } catch (e) { return null }
}
const writeJSON = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) {}
}

const dayOfYear = (d) => Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000)

async function getCoords() {
  try {
    const pos = await Geolocation.getCurrentPosition({ timeout: 10000, enableHighAccuracy: false })
    const c = { lat: pos.coords.latitude, lng: pos.coords.longitude }
    writeJSON(KEY_COORDS, c)
    return c
  } catch (e) {
    return readJSON(KEY_COORDS)
  }
}

async function fetchMonth(lat, lng, year, month) {
  const url =
    `https://api.aladhan.com/v1/calendar/${year}/${month}` +
    `?latitude=${lat}&longitude=${lng}` +
    `&method=99&methodSettings=18,4,14&school=0&midnightMode=1`
  const res = await fetch(url)
  const json = await res.json()
  return (json && json.data) || []
}

function toDate(ddmmyyyy, hhmm) {
  const [d, m, y] = ddmmyyyy.split('-').map(Number)
  const clean = String(hhmm).trim().split(' ')[0]
  const [h, min] = clean.split(':').map(Number)
  if ([d, m, y, h, min].some((n) => isNaN(n))) return null
  return new Date(y, m - 1, d, h, min, 0, 0)
}

async function ensureChannels() {
  try {
    await LocalNotifications.createChannel({
      id: CH_ADHAN,
      name: 'الأذان ومواقيت الصلاة',
      description: 'تنبيه بصوت الأذان عند دخول وقت الصلاة',
      importance: 5,
      visibility: 1,
      sound: 'adhan',
      vibration: true,
      lights: true,
      lightColor: '#C6A15B',
    })
  } catch (e) { console.warn('ch adhan:', e) }

}

async function clearPending() {
  try {
    const pending = await LocalNotifications.getPending()
    if (pending && pending.notifications && pending.notifications.length) {
      await LocalNotifications.cancel({ notifications: pending.notifications })
    }
  } catch (e) { console.warn('clear:', e) }
}

/* ---------------- بناء قائمة الأذان ---------------- */
async function buildAdhanList(now) {
  if (!isAdhanEnabled()) return []

  const coords = await getCoords()
  if (!coords) return []

  const months = [{ y: now.getFullYear(), m: now.getMonth() + 1 }]
  const nx = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  months.push({ y: nx.getFullYear(), m: nx.getMonth() + 1 })

  let days = []
  for (const { y, m } of months) {
    try {
      days = days.concat(await fetchMonth(coords.lat, coords.lng, y, m))
    } catch (e) { console.warn('fetch month:', e) }
  }
  if (!days.length) return []

  const limit = new Date(now.getTime() + ADHAN_DAYS * 86400000)
  const out = []

  for (const day of days) {
    const dateStr = day && day.date && day.date.gregorian && day.date.gregorian.date
    const timings = day && day.timings
    if (!dateStr || !timings) continue

    PRAYERS.forEach(([key, label], idx) => {
      const at = toDate(dateStr, timings[key])
      if (!at || at <= now || at > limit) return

      out.push({
        id: dayOfYear(at) * 10 + idx,          // 0،1،2
        channelId: CH_ADHAN,
        title: 'حان وقت صلاة ' + label,
        body: 'هيئة الشيخ أحمد الوائلي',
        sound: 'adhan',
        schedule: { at, allowWhileIdle: true },
      })
    })
  }
  return out
}

/* ---------------- بناء قائمة التذكيرات ---------------- */
function buildRemindersList(now) {
  const out = []
  let counter = 0

  for (let d = 0; d <= REMIND_DAYS; d++) {
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d)

    REMIND_HOURS.forEach((hour, idx) => {
      const at = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, 0, 0, 0)
      if (at <= now) return

      const msg = reminderAt(counter++)
      out.push({
        id: dayOfYear(at) * 10 + 5 + idx,      // 5،6،7 — لا تتصادم مع الأذان
        title: msg.title,
        body: msg.body,
        schedule: { at, allowWhileIdle: true },
      })
    })
  }
  return out
}

/* ---------------- الجدولة ---------------- */
export async function schedulePrayerNotifications({ force = false } = {}) {
  if (!Capacitor.isNativePlatform()) return

  if (!force) {
    const last = readJSON(KEY_STAMP)
    if (last && Date.now() - last < 20 * 60 * 60 * 1000) return
  }

  const perm = await LocalNotifications.requestPermissions()
  if (perm.display !== 'granted') return

  await ensureChannels()

  const now = new Date()
  const adhanList = await buildAdhanList(now)
  const remindList = buildRemindersList(now)

  const all = adhanList.concat(remindList)

  await clearPending()
  if (!all.length) return

  for (let i = 0; i < all.length; i += 20) {
    try {
      await LocalNotifications.schedule({ notifications: all.slice(i, i + 20) })
    } catch (e) {
      console.warn('schedule batch:', e)
      break
    }
  }

  writeJSON(KEY_STAMP, Date.now())
}

/* يُستدعى عند تغيير خيار الأذان من الإعدادات */
export async function refreshPrayerNotifications() {
  return schedulePrayerNotifications({ force: true })
}
