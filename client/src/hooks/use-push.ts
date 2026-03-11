import { useState, useEffect } from "react";
import { api } from "@shared/routes";
import { urlBase64ToUint8Array } from "@/lib/utils";

async function doSubscribe() {
  const registration = await navigator.serviceWorker.register('/sw.js');
  const vapidRes = await fetch(api.push.vapidPublicKey.path, { credentials: "include" });
  if (!vapidRes.ok) throw new Error("Failed to fetch VAPID key");
  const { publicKey } = await vapidRes.json();
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await fetch(api.push.subscribe.path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription),
    credentials: "include",
  });
}

export function usePushNotifications(isAuthenticated: boolean) {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;

    if (Notification.permission === "granted") {
      // Already permitted — subscribe silently (no user gesture needed)
      doSubscribe().catch(err => console.error("Push subscribe error:", err));
    } else if (Notification.permission === "default") {
      // Not yet asked — show the banner so the user can trigger it with a tap
      setShowBanner(true);
    }
    // "denied" — do nothing
  }, [isAuthenticated]);

  const enableNotifications = async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        await doSubscribe();
      }
    } catch (err) {
      console.error("Push enable error:", err);
    } finally {
      setShowBanner(false);
    }
  };

  return { showBanner, enableNotifications };
}
