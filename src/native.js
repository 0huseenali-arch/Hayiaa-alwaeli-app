// ============================================================
//  native.js — الجسر بين التطبيق الأصلي (Capacitor) وكود الويب
//  يُستدعى مرة واحدة من main.jsx عند بدء التطبيق.
//  لا يعمل شيء منه داخل المتصفح.
// ============================================================

import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { Geolocation } from '@capacitor/geolocation'
import { LocalNotifications } from '@capacitor/local-notifications'
import { schedulePrayerNotifications } from './prayerNotifications.js'

const ONESIGNAL_APP_ID = '601cac8e-baf6-40d1-ba32-75fef5f02281'
const EXIT_WINDOW_MS = 2000

let lastBackPress = 0
let depth = 0
let oneSignal = null

/* المحافظات — لتحديد الأقرب لموقع المستخدم */
const GOVERNORATES = [
  { slug: 'baghdad', lat: 33.3152, lng: 44.3661 },
  { slug: 'basra', lat: 30.5085, lng: 47.7804 },
  { slug: 'nineveh', lat: 36.3489, lng: 43.1189 },
  { slug: 'erbil', lat: 36.1911, lng: 44.0092 },
  { slug: 'sulaymaniyah', lat: 35.5558, lng: 45.4351 },
  { slug: 'duhok', lat: 36.8617, lng: 42.9891 },
  { slug: 'kirkuk', lat: 35.4681, lng: 44.3922 },
  { slug: 'najaf', lat: 31.9955, lng: 44.3283 },
  { slug: 'karbala', lat: 32.6149, lng: 44.0246 },
  { slug: 'babil', lat: 32.4645, lng: 44.4162 },
  { slug: 'wasit', lat: 32.5122, lng: 45.8235 },
  { slug: 'maysan', lat: 31.8353, lng: 47.1481 },
  { slug: 'dhiqar', lat: 31.0563, lng: 46.2585 },
  { slug: 'muthanna', lat: 31.3234, lng: 45.2949 },
  { slug: 'qadisiyyah', lat: 31.989, lng: 44.9199 },
  { slug: 'anbar', lat: 33.4207, lng: 43.3009 },
  { slug: 'salahaldin', lat: 34.6081, lng: 43.6779 },
  { slug: 'diyala', lat: 33.7461, lng: 44.6434 },
]

function nearestGov(lat, lng) {
  let best = null
  let bestD = Infinity
  for (const g of GOVERNORATES) {
    const dx = (g.lng - lng) * Math.cos((lat * Math.PI) / 180)
    const dy = g.lat - lat
    const d = dx * dx + dy * dy
    if (d < bestD) { bestD = d; best = g }
  }
  return best ? best.slug : 'baghdad'
}

/* ---------- تتبّع عمق التنقّل ---------- */
function trackDepth() {
  const originalPush = window.history.pushState.bind(window.history)
  window.history.pushState = function (...args) {
    depth++
    return originalPush(...args)
  }
  window.addEventListener('popstate', () => { if (depth > 0) depth-- })
}

/* ---------- تلميح الخروج ---------- */
function showExitHint() {
  let el = document.getElementById('exit-hint')
  if (!el) {
    el = document.createElement('div')
    el.id = 'exit-hint'
    el.textContent = 'اضغط رجوع مرة أخرى للخروج'
    el.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:80px',
      'transform:translateX(-50%)',
      'background:rgba(0,0,0,0.85)', 'color:#fff',
      'padding:10px 20px', 'border-radius:24px',
      'font-family:Cairo,sans-serif', 'font-size:14px',
      'z-index:99999', 'pointer-events:none',
      'transition:opacity .3s',
    ].join(';')
    document.body.appendChild(el)
  }
  el.style.opacity = '1'
  clearTimeout(el._t)
  el._t = setTimeout(() => { el.style.opacity = '0' }, EXIT_WINDOW_MS)
}

/* ---------- زر الرجوع ---------- */
function setupBackButton() {
  CapApp.addListener('backButton', () => {
    if (depth > 0) {
      window.history.back()
      lastBackPress = 0
      return
    }
    const now = Date.now()
    if (now - lastBackPress < EXIT_WINDOW_MS) CapApp.exitApp()
    else { lastBackPress = now; showExitHint() }
  })
}

/* ---------- إذن الإشعارات ---------- */
async function requestNotificationPermission() {
  try {
    const st = await LocalNotifications.checkPermissions()
    if (st.display !== 'granted') await LocalNotifications.requestPermissions()
  } catch (e) {
    console.warn('notification permission:', e)
  }
}

/* ---------- إذن الموقع ---------- */
async function requestLocationPermission() {
  try {
    const status = await Geolocation.checkPermissions()
    if (status.location !== 'granted' && status.coarseLocation !== 'granted') {
      await Geolocation.requestPermissions()
    }
  } catch (e) {
    console.warn('location permission:', e)
  }
}

/* ---------- OneSignal ---------- */
async function initOneSignal() {
  try {
    const mod = await import('onesignal-cordova-plugin')
    oneSignal = mod.default || mod
    oneSignal.initialize(ONESIGNAL_APP_ID)
    oneSignal.Notifications.requestPermission(true)
  } catch (e) {
    console.warn('OneSignal:', e)
  }
}

/* يضع وسم المحافظة تلقائياً ليصل إشعار الصلاة بتوقيت منطقة المستخدم */
async function tagGovernorate() {
  if (!oneSignal) return
  try {
    let coords = null
    try {
      const pos = await Geolocation.getCurrentPosition({ timeout: 10000, enableHighAccuracy: false })
      coords = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      localStorage.setItem('hayaa_last_coords', JSON.stringify(coords))
    } catch (e) {
      const saved = localStorage.getItem('hayaa_last_coords')
      if (saved) coords = JSON.parse(saved)
    }

    const slug = coords ? nearestGov(coords.lat, coords.lng) : 'baghdad'
    oneSignal.User.addTag('gov', slug)

    if (localStorage.getItem('hayaa_gov') !== slug) {
      localStorage.setItem('hayaa_gov', slug)
    }
  } catch (e) {
    console.warn('gov tag:', e)
  }
}

/* ---------- نقطة الدخول ---------- */
export function initNative() {
  if (!Capacitor.isNativePlatform()) return

  trackDepth()
  setupBackButton()

  setTimeout(async () => {
    await requestNotificationPermission()
    await initOneSignal()
    await requestLocationPermission()
    await tagGovernorate()
    schedulePrayerNotifications()
  }, 2000)

  CapApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) {
      schedulePrayerNotifications()
      tagGovernorate()
    }
  })
}
