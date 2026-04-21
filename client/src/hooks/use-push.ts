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

async function doSubscribe(): Promise<void> {
  console.log('[Push] Starting subscription flow...');

  // Wait for an active service worker — register it first if needed.
  // Registration is idempotent; calling it every time is safe.
  await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  const registration = await navigator.serviceWorker.ready;

  const swState = registration.installing ? 'installing'
    : registration.waiting   ? 'waiting'
    : registration.active    ? 'active'
    : 'unknown';
  console.log('[Push] Service worker state:', swState, '— scope:', registration.scope);

  // Fetch VAPID key from the backend (always fresh, so it always matches server env).
  const vapidRes = await fetch(api.push.vapidPublicKey.path, { credentials: 'include' });
  if (!vapidRes.ok) {
    throw new Error(`[Push] Failed to fetch VAPID key — HTTP ${vapidRes.status}`);
  }
  const { publicKey } = await vapidRes.json();
  if (!publicKey) {
    throw new Error('[Push] VAPID_PUBLIC_KEY is empty on the server — check env vars');
  }
  console.log('[Push] VAPID key received — prefix:', publicKey.slice(0, 12) + '…');

  // Always unsubscribe the existing browser subscription first.
  // This guarantees the endpoint we POST to the backend is always fresh and
  // avoids 403/410 errors that occur when the browser still holds a
  // subscription that the backend already deleted.
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    console.log('[Push] Removing existing subscription — endpoint suffix:', existing.endpoint.slice(-24));
    await existing.unsubscribe();
  } else {
    console.log('[Push] No existing browser subscription found');
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  console.log('[Push] New subscription created — endpoint suffix:', subscription.endpoint.slice(-24));

  await sendSubscriptionToBackend(subscription);
  console.log('[Push] Subscription successfully upserted on backend ✓');
}

async function sendSubscriptionToBackend(subscription: PushSubscription): Promise<void> {
  const res = await fetch(api.push.subscribe.path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription),
    credentials: 'include',
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`[Push] Backend upsert failed — HTTP ${res.status} ${detail}`);
  }
}


export function usePushNotifications(isAuthenticated: boolean, isAuthLoading: boolean) {
  const [showBanner, setShowBanner] = useState(false);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);

  useEffect(() => {
    // Wait until /api/me has fully resolved before attempting push subscribe.
    if (isAuthLoading || !isAuthenticated) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      console.log('[Push] Push not supported in this browser — skipping');
      return;
    }

    // Log current permission so we can see it in the console on every load.
    console.log('[Push] Notification permission on load:', Notification.permission);

    // On iOS, push only works inside an installed PWA (standalone mode).
    if (isIOS() && !isStandalone()) {
      console.log('[Push] iOS browser (not standalone) — showing install prompt');
      setShowInstallPrompt(true);
      return;
    }

    if (Notification.permission === 'granted') {
      // Run on every mount so a fresh subscription is always registered.
      // The effect dependency array ([isAuthenticated, isAuthLoading]) means
      // this fires exactly once per page load once auth resolves — no
      // ref guard needed and no risk of spamming the backend.
      doSubscribe().catch(err => console.error('[Push] Subscribe error:', err));
    } else if (Notification.permission === 'default') {
      // Not yet asked — show the banner so the user can enable with a tap.
      setShowBanner(true);
    } else {
      console.log('[Push] Notifications denied — user must reset permission in browser settings');
    }
  }, [isAuthenticated, isAuthLoading]);

  const enableNotifications = async () => {
    try {
      console.log('[Push] Requesting notification permission...');
      const permission = await Notification.requestPermission();
      console.log('[Push] Permission result:', permission);
      if (permission === 'granted') {
        await doSubscribe();
      }
    } catch (err) {
      console.error('[Push] Enable error:', err);
    } finally {
      setShowBanner(false);
    }
  };

  const dismissInstallPrompt = () => setShowInstallPrompt(false);

  return { showBanner, showInstallPrompt, enableNotifications, dismissInstallPrompt };
}
