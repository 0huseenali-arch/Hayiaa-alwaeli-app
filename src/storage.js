/*
  طبقة تخزين حقيقية مبنية على Firebase Realtime Database.
  مشتركة فعلياً بين كل الزوار حول العالم (وليست محلية بالمتصفح).

  - get/set/delete: للقيم المفردة (منشورات، محتوى، إعدادات).
  - getCollection/addItem/removeItem: لتخزين كل عنصر (صورة/كتاب) تحت
    مفتاح مستقل داخل مجموعة، بدل حفظ القائمة كلها ككتلة واحدة ضخمة.
    هذا أسرع وأأمن: إضافة عنصر تكتبه وحده دون لمس باقي العناصر.
*/

import { db } from "./firebase";
import { ref, set as fbSet, get as fbGet, remove as fbRemove, push, child } from "firebase/database";

const storage = {
  async get(key) {
    const snap = await fbGet(ref(db, key));
    if (!snap.exists()) return null;
    return { key, value: snap.val() };
  },
  async set(key, value) {
    await fbSet(ref(db, key), value);
    return { key, value };
  },
  async delete(key) {
    await fbRemove(ref(db, key));
    return { key, deleted: true };
  },

  // يقرأ كل عناصر المجموعة كمصفوفة، الأحدث أولاً
  async getCollection(path) {
    const snap = await fbGet(ref(db, path));
    if (!snap.exists()) return [];
    const val = snap.val();
    return Object.keys(val)
      .map((k) => ({ ...val[k], _key: k }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  },
  // يضيف عنصراً واحداً بمفتاح مستقل (يكتبه وحده فقط)
  async addItem(path, item) {
    const newRef = push(child(ref(db), path));
    const payload = { ...item, createdAt: Date.now() };
    await fbSet(newRef, payload);
    return { ...payload, _key: newRef.key };
  },
  // يحذف عنصراً واحداً بمفتاحه المستقل
  async removeItem(path, itemKey) {
    await fbRemove(ref(db, `${path}/${itemKey}`));
    return { deleted: true };
  },
};

export default storage;
