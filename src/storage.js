/*
  بديل بسيط لخاصية window.storage الخاصة ببيئة Claude —
  يحفظ البيانات محلياً على متصفح الزائر (localStorage).

  ملاحظة مهمة: هذا التخزين محلي لكل متصفح على حدة، أي منشور
  ينشره الأدمن من متصفحه يظهر له فقط، وليس لبقية الزوار.
  لجعل المنشورات مشتركة فعلياً بين كل الزوار (كما هو مخطط
  بالمرحلة الثالثة من المشروع)، يجب ربط هذا الملف لاحقاً
  بقاعدة بيانات سحابية مثل Firebase بدلاً من localStorage.
*/

const storage = {
  async get(key) {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    return { key, value: raw };
  },
  async set(key, value) {
    localStorage.setItem(key, value);
    return { key, value };
  },
  async delete(key) {
    localStorage.removeItem(key);
    return { key, deleted: true };
  },
};

export default storage;
