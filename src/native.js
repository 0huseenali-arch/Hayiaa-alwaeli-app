// ============================================================
//  native.js — الجسر بين التطبيق الأصلي (Capacitor) وكود الويب
//  يُستدعى مرة واحدة من main.jsx عند بدء التطبيق.
//  لا يعمل شيء منه داخل المتصفح — يعمل فقط داخل تطبيق أندرويد.
// ============================================================

import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { Geolocation } from '@capacitor/geolocation'

// المدة التي تُحتسب فيها الضغطتان "متتاليتين" للخروج
const EXIT_WINDOW_MS = 2000

let lastBackPress = 0

// عدّاد العمق: كم صفحة داخلين فعلياً من الرئيسية
// (لا نستخدم window.history.length لأنه يزيد ولا ينقص أبداً)
let depth = 0

// ---------- تتبّع عمق التنقّل ----------
function trackDepth() {
  const originalPush = window.history.pushState.bind(window.history)

  window.history.pushState = function (...args) {
    depth++
    return originalPush(...args)
  }

  window.addEventListener('popstate', () => {
    if (depth > 0) depth--
  })
}

// ---------- تلميح الخروج ----------
function showExitHint() {
  let el = document.getElementById('exit-hint')
  if (!el) {
    el = document.createElement('div')
    el.id = 'exit-hint'
    el.textContent = 'اضغط رجوع مرة أخرى للخروج'
    el.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:80px',
      'transform:translateX(-50%)',
      'background:rgba(0,0,0,0.85)',
      'color:#fff',
      'padding:10px 20px',
      'border-radius:24px',
      'font-family:Cairo,sans-serif',
      'font-size:14px',
      'z-index:99999',
      'pointer-events:none',
      'transition:opacity .3s',
    ].join(';')
    document.body.appendChild(el)
  }
  el.style.opacity = '1'
  clearTimeout(el._t)
  el._t = setTimeout(() => { el.style.opacity = '0' }, EXIT_WINDOW_MS)
}

// ---------- زر الرجوع الفيزيائي وإيماءة السحب ----------
function setupBackButton() {
  CapApp.addListener('backButton', () => {
    // ما زلنا داخل الأقسام: نرجع صفحة واحدة
    if (depth > 0) {
      window.history.back()
      lastBackPress = 0
      return
    }

    // إحنا بالصفحة الرئيسية: ضغطتان للخروج
    const now = Date.now()
    if (now - lastBackPress < EXIT_WINDOW_MS) {
      CapApp.exitApp()
    } else {
      lastBackPress = now
      showExitHint()
    }
  })
}

// ---------- إذن الموقع (لمواقيت الصلاة واتجاه القبلة) ----------
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

// ---------- نقطة الدخول ----------
export function initNative() {
  if (!Capacitor.isNativePlatform()) return   // داخل المتصفح: لا نفعل شيئاً

  trackDepth()
  setupBackButton()

  // نطلب الإذن بعد ثانيتين حتى لا تظهر النافذة فوق شاشة البداية
  setTimeout(requestLocationPermission, 2000)
}
