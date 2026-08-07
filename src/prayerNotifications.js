// ============================================================
//  prayerNotifications.js — الأذان المحلي على الجهاز
//
//  يجدول الأذان بصوته عند دخول وقت الصلاة داخل الهاتف نفسه،
//  فيعمل والتطبيق مسكّر والشاشة مطفية وبدون إنترنت.
//
//  أما إشعارات المحتوى السبعة (آية اليوم، الحديث، الصلاة على
//  محمد وآله، اقتباس الشيخ، أذكار المساء، دعاء اليوم، صلاة
//  الليل) فتأتي من السيرفر عبر OneSignal — لأن إشعارات
//  السيرفر لا يؤجّلها نظام توفير الطاقة.
//
//  لا يعمل شيء منه داخل المتصفح.
// ============================================================

import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { Geolocation } from '@capacitor/geolocation'

const CH_ADHAN = 'adhan'

const ADHAN_DAYS = 30       // كم يوماً نجدول الأذان مسبقاً

const KEY_COORDS = 'hayaa_last_coords'
const KEY_STAMP = 'hayaa_sched_at'
const KEY_ADHAN = 'hayaa_adhan'

const PRAYERS = [
  ['Fajr', 'الفجر'],
  ['Dhuhr', 'الظهر'],
  ['Maghrib', 'المغرب'],
]

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
  const all = await buildAdhanList(now)

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
