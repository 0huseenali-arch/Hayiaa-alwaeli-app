/*
  رفع الملفات الحقيقي عبر Firebase Storage.
  يستخدم uploadBytesResumable لإتاحة متابعة نسبة التقدم الفعلية أثناء الرفع.
*/

import { fileStorage } from "./firebase";
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from "firebase/storage";

// onProgress: دالة تستقبل رقماً من 0 إلى 100
export function uploadFile(folder, file, onProgress) {
  return new Promise((resolve, reject) => {
    const path = `${folder}/${Date.now()}_${file.name}`;
    const storageRef = ref(fileStorage, path);
    const task = uploadBytesResumable(storageRef, file);

    task.on(
      "state_changed",
      (snapshot) => {
        if (onProgress && snapshot.totalBytes) {
          const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          onProgress(pct);
        }
      },
      (error) => reject(error),
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          resolve({ url, path });
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

export async function deleteFile(path) {
  if (!path) return;
  try {
    await deleteObject(ref(fileStorage, path));
  } catch (e) {
    console.warn("deleteFile:", e.message);
  }
}
