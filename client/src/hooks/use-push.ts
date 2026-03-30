import { useState, useEffect } from "react";
import { api } from "@shared/routes";
import { urlBase64ToUint8Array } from "@/lib/utils";

/** Detect if running as installed PWA (standalone / fullscreen) */
function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  );
}

/** Detect iOS */
function isIOS(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

async function doSubscribe() {
  const registration = await navigator.serviceWorker.ready; // wait for active SW
  const vapidRes = await fetch(api.push.vapidPublicKey.path, { credentials: "include" });
  if (!vapidRes.ok) throw new Error("Failed to fetch VAPID key");
  const { publicKey } = await vapidRes.json();

  // Check for existing subscription — reuse if still valid
  let subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    // Validate the key hasn't changed
    const existingKey = subscription.options?.applicationServerKey;
    const newKey = urlBase64ToUint8Array(publicKey);
    if (existingKey && arrayBufferEqual(existingKey, newKey.buffer)) {
      // Existing subscription is valid — just re-register with backend
      await sendSubscriptionToBackend(subscription);
      return;
    }
    // Key changed — unsubscribe old one
    await subscription.unsubscribe();
  }

  subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await sendSubscriptionToBackend(subscription);
}

async function sendSubscriptionToBackend(subscription: PushSubscription) {
  await fetch(api.push.subscribe.path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription),
    credentials: "include",
  });
}

function arrayBufferEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const va = new Uint8Array(a);
  const vb = new Uint8Array(b);
  for (let i = 0; i < va.length; i++) {
    if (va[i] !== vb[i]) return false;
  }
  return true;
}

export function usePushNotifications(isAuthenticated: boolean, isAuthLoading: boolean) {
  const [showBanner, setShowBanner] = useState(false);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);

  useEffect(() => {
    // Wait until /api/me has fully resolved before attempting push subscribe.
    // Firing while loading risks a stale-cache race where isAuthenticated is
    // true from a cached response but the actual session is not yet confirmed.
    if (isAuthLoading || !isAuthenticated) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;

    // Register SW early so it's ready
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(err =>
      console.error("SW registration error:", err)
    );

    // On iOS, push only works inside installed PWA (standalone mode)
    if (isIOS() && !isStandalone()) {
      setShowInstallPrompt(true);
      return;
    }

    if (Notification.permission === "granted") {
      // Already permitted — re-subscribe to ensure backend has current subscription
      // This handles the case where subscription was lost after PWA reinstall
      doSubscribe().catch(err => console.error("Push subscribe error:", err));
    } else if (Notification.permission === "default") {
      // Not yet asked — show the banner so the user can trigger it with a tap
      setShowBanner(true);
    }
    // "denied" — do nothing
  }, [isAuthenticated, isAuthLoading]);

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

  const dismissInstallPrompt = () => setShowInstallPrompt(false);

  return { showBanner, showInstallPrompt, enableNotifications, dismissInstallPrompt };
}
