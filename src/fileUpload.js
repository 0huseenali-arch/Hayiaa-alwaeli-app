/*
  رفع الملفات عبر Firebase Realtime Database مباشرة (بصيغة base64) —
  بدل الاعتماد على خدمة خارجية ثالثة (مثل Cloudinary) قد تكون محجوبة
  في بعض الدول بسبب قيود العقوبات الأمريكية العامة على خدمات SaaS.
  هذا الأسلوب يعتمد فقط على Firebase، وهو نفس النظام المستخدم أصلاً
  بالتطبيق ومؤكد إنه يشتغل في العراق.
*/

export async function uploadFile(_folder, file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  // لا يوجد "مسار" منفصل بهذا الأسلوب — البيانات نفسها هي الملف
  return { url: dataUrl, path: null };
}

export async function deleteFile(_path) {
  // لا حاجة لحذف خارجي — الحذف يتم من قائمة العناصر داخل Firebase مباشرة
  return true;
}
