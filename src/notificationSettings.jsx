// NotificationSettings.jsx
// مكوّن جاهز يُلصق داخل قسم "الإعدادات" بملف App.jsx
// ⚠️ عدّل الاستيرادات لتطابق مكتبة الأيقونات وأسلوب الأزرار عندك بالتطبيق

import { useState } from "react";
import {
  enableNotifications,
  getSavedNotificationSettings,
  GOVERNORATES,
  DEFAULT_PREFS,
} from "./notifications";

export default function NotificationSettings() {
  const saved = getSavedNotificationSettings();
  const [governorate, setGovernorate] = useState(saved.governorate || "");
  const [prefs, setPrefs] = useState(saved.prefs || DEFAULT_PREFS);
  const [status, setStatus] = useState(null); // null | 'loading' | 'success' | 'error'

  const togglePref = (key) =>
    setPrefs((p) => ({ ...p, [key]: !p[key] }));

  const handleSave = async () => {
    if (!governorate) {
      setStatus("need-governorate");
      return;
    }
    setStatus("loading");
    const res = await enableNotifications(governorate, prefs);
    setStatus(res.success ? "success" : "error");
  };

  return (
    <div className="settings-section" dir="rtl">
      <h3>الإشعارات</h3>

      <label className="settings-label">محافظتك (لدقّة مواقيت الصلاة والأذان)</label>
      <select
        value={governorate}
        onChange={(e) => setGovernorate(e.target.value)}
        className="settings-select"
      >
        <option value="">اختر المحافظة</option>
        {GOVERNORATES.map((g) => (
          <option key={g.slug} value={g.slug}>
            {g.name}
          </option>
        ))}
      </select>

      <div className="settings-toggle-row">
        <span>منشور جديد من الهيئة</span>
        <input
          type="checkbox"
          checked={prefs.newPost}
          onChange={() => togglePref("newPost")}
        />
      </div>

      <div className="settings-toggle-row">
        <span>تذكير مواقيت الصلاة</span>
        <input
          type="checkbox"
          checked={prefs.prayerTimes}
          onChange={() => togglePref("prayerTimes")}
        />
      </div>

      <div className="settings-toggle-row">
        <span>الأذان عند دخول الوقت</span>
        <input
          type="checkbox"
          checked={prefs.adhan}
          onChange={() => togglePref("adhan")}
        />
      </div>

      <div className="settings-toggle-row">
        <span>آية / حكمة يومية</span>
        <input
          type="checkbox"
          checked={prefs.dailyVerse}
          onChange={() => togglePref("dailyVerse")}
        />
      </div>

      <button className="settings-save-btn" onClick={handleSave}>
        {status === "loading" ? "جاري التفعيل..." : "حفظ إعدادات الإشعارات"}
      </button>

      {status === "success" && (
        <p className="settings-msg-success">تم تفعيل الإشعارات بنجاح ✅</p>
      )}
      {status === "denied" && (
        <p className="settings-msg-error">لازم تسمح بالإشعارات من إعدادات المتصفح/الجهاز</p>
      )}
      {status === "error" && (
        <p className="settings-msg-error">صار خطأ، جرّب مرة ثانية</p>
      )}
      {status === "need-governorate" && (
        <p className="settings-msg-error">اختر محافظتك أولاً</p>
      )}
    </div>
  );
}
