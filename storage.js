/*
  طبقة تخزين حقيقية مبنية على Firebase Realtime Database.
  بنفس واجهة الاستخدام السابقة (get/set/delete) حتى لا نحتاج
  لتعديل بقية الكود — لكنها الآن مشتركة فعلياً بين كل الزوار
  حول العالم، وليست محلية بالمتصفح.
*/

import { db } from "./firebase";
import { ref, set as fbSet, get as fbGet, remove as fbRemove } from "firebase/database";

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
};

export default storage;
