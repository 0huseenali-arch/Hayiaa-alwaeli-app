// ============================================================
//  prayerNotifications.js — جدولة الأذان محلياً على الجهاز
//
//  يجلب مواقيت شهر كامل مرة واحدة من api.aladhan.com (نفس طريقة
//  الحساب المستعملة داخل التطبيق: جعفرية 18/4/14)، ثم يجدول
//  إشعارات محلية داخل الهاتف نفسه.
//
//  بعد الجدولة يشتغل الأذان حتى لو:
//    - التطبيق مسكّر تماماً
//    - الشاشة مطفية
//    - الإنترنت مقطوع
//
//  لا يعمل شيء منه داخل المتصفح.
// ============================================================

import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { Geolocation } from '@capacitor/geolocation'

const CHANNEL_ID = 'adhan'
const DAYS_AHEAD = 30

const KEY_COORDS = 'hayaa_last_coords'
const KEY_STAMP = 'hayaa_adhan_scheduled_at'
const KEY_ADHAN = 'hayaa_adhan'          // نفس المفتاح المستعمل في الإعدادات

// نفس ترتيب الصلوات المعتمد بالتطبيق (ثلاثة أوقات)
const PRAYERS = [
  ['Fajr', 'الفجر'],
  ['Dhuhr', 'الظهر'],
  ['Maghrib', 'المغرب'],
]

const isAdhanEnabled = () => {
  try { return localStorage.getItem(KEY_ADHAN) === '1' } catch (e) { return false }
}

const readJSON = (k) => {
  try { return JSON.parse(localStorage.getItem(k) || 'null') } catch (e) { return null }
}
const writeJSON = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) {}
}

/* ---------------- إحداثيات المستخدم ---------------- */
async function getCoords() {
  try {
    const pos = await Geolocation.getCurrentPosition({ timeout: 10000, enableHighAccuracy: false })
    const c = { lat: pos.coords.latitude, lng: pos.coords.longitude }
    writeJSON(KEY_COORDS, c)
    return c
  } catch (e) {
    // تعذّر تحديد الموقع الآن — نستعمل آخر موقع محفوظ
    return readJSON(KEY_COORDS)
  }
}

/* ---------------- جلب مواقيت شهر كامل ---------------- */
async function fetchMonth(lat, lng, year, month) {
  const url =
    `https://api.aladhan.com/v1/calendar/${year}/${month}` +
    `?latitude=${lat}&longitude=${lng}` +
    `&method=99&methodSettings=18,4,14&school=0&midnightMode=1`

  const res = await fetch(url)
  const json = await res.json()
  return (json && json.data) || []
}

/* يحوّل "04:12 (+03)" و "04-08-2026" إلى كائن Date محلي */
function toDate(ddmmyyyy, hhmm) {
  const [d, m, y] = ddmmyyyy.split('-').map(Number)
  const clean = String(hhmm).trim().split(' ')[0]
  const [h, min] = clean.split(':').map(Number)
  if ([d, m, y, h, min].some((n) => isNaN(n))) return null
  return new Date(y, m - 1, d, h, min, 0, 0)
}

/* ---------------- إنشاء قناة الإشعارات ---------------- */
async function ensureChannel() {
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: 'الأذان ومواقيت الصلاة',
      description: 'تنبيه عند دخول وقت الصلاة',
      importance: 5,          // أعلى أهمية — يظهر فوق الشاشة ويصدر صوتاً
      visibility: 1,
      sound: 'adhan',         // يشير إلى android/app/src/main/res/raw/adhan.mp3
      vibration: true,
      lights: true,
      lightColor: '#C6A15B',
    })
  } catch (e) {
    console.warn('channel:', e)
  }
}

/* ---------------- إلغاء كل ما هو مجدول ---------------- */
async function clearPending() {
  try {
    const pending = await LocalNotifications.getPending()
    if (pending && pending.notifications && pending.notifications.length) {
      await LocalNotifications.cancel({ notifications: pending.notifications })
    }
  } catch (e) {
    console.warn('clear:', e)
  }
}

/* ---------------- الجدولة ---------------- */
export async function schedulePrayerNotifications({ force = false } = {}) {
  if (!Capacitor.isNativePlatform()) return

  // الأذان مطفأ من الإعدادات → نلغي كل شيء مجدول
  if (!isAdhanEnabled()) {
    await clearPending()
    return
  }

  // لا نعيد الجدولة أكثر من مرة كل 24 ساعة إلا بطلب صريح
  if (!force) {
    const last = readJSON(KEY_STAMP)
    if (last && Date.now() - last < 20 * 60 * 60 * 1000) return
  }

  const perm = await LocalNotifications.requestPermissions()
  if (perm.display !== 'granted') return

  const coords = await getCoords()
  if (!coords) return

  await ensureChannel()

  const now = new Date()
  const months = [{ y: now.getFullYear(), m: now.getMonth() + 1 }]
  const nx = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  months.push({ y: nx.getFullYear(), m: nx.getMonth() + 1 })

  let days = []
  for (const { y, m } of months) {
    try {
      const data = await fetchMonth(coords.lat, coords.lng, y, m)
      days = days.concat(data)
    } catch (e) {
      console.warn('fetch month:', e)
    }
  }
  if (!days.length) return

  const limit = new Date(now.getTime() + DAYS_AHEAD * 24 * 60 * 60 * 1000)
  const list = []

  for (const day of days) {
    const dateStr = day && day.date && day.date.gregorian && day.date.gregorian.date
    const timings = day && day.timings
    if (!dateStr || !timings) continue

    PRAYERS.forEach(([key, label], idx) => {
      const at = toDate(dateStr, timings[key])
      if (!at) return
      if (at <= now || at > limit) return

      // معرّف فريد وثابت: يوم السنة × 10 + رقم الصلاة
      const dayOfYear = Math.floor((at - new Date(at.getFullYear(), 0, 0)) / 86400000)
      const id = dayOfYear * 10 + idx

      list.push({
        id,
        channelId: CHANNEL_ID,
        title: 'حان وقت صلاة ' + label,
        body: 'هيئة الشيخ أحمد الوائلي',
        sound: 'adhan',
        smallIcon: 'ic_stat_icon_config_sample',
        schedule: { at, allowWhileIdle: true },
      })
    })
  }

  if (!list.length) return

  await clearPending()

  // نجدول على دفعات صغيرة تفادياً لحدود النظام
  for (let i = 0; i < list.length; i += 20) {
    try {
      await LocalNotifications.schedule({ notifications: list.slice(i, i + 20) })
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
