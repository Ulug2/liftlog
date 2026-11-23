/**
 * Timer notifications.
 *
 * iPhone web apps can't show a live, ticking Lock Screen timer (that's Live Activities,
 * native apps only). What they can do — once added to the Home Screen — is show
 * notifications and receive Web Push. So:
 *   • When LiftLog goes to the background mid-workout, it posts a "workout in progress"
 *     notification and a "resting · next set at 6:12:30 PM" notification.
 *   • It also schedules a "Rest over" push on the server, delivered at the exact time
 *     even if the phone is locked.
 *   • When LiftLog comes back to the foreground, all of it is cleared/cancelled.
 */
import { useSyncExternalStore } from 'react';
import { getMeta, putMeta } from './db';
import { getSupabase, SUPABASE_KEY, SUPABASE_URL, syncConfigured } from './supabase';
import { getAccessToken } from './sync';

const FN_URL = `${SUPABASE_URL}/functions/v1/push`;

export type NotifyStatus = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on';

const listeners = new Set<() => void>();
let version = 0;
const bump = () => {
  version++;
  listeners.forEach((l) => l());
};

export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function getNotifyStatus(): NotifyStatus {
  if (!syncConfigured) return 'unsupported';
  const hasApis = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  if (!hasApis) return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'granted' && getMeta<boolean>('notifyEnabled')) return 'on';
  return 'off';
}

export function useNotifyStatus(): NotifyStatus {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
  return getNotifyStatus();
}

const b64url = (buf: ArrayBuffer | null) => {
  if (!buf) return '';
  let s = '';
  new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/** Must be called from a tap (iOS only allows the permission prompt from a user gesture). */
export async function enableNotifications(): Promise<{ ok: boolean; message?: string }> {
  const status = getNotifyStatus();
  if (status === 'needs-install') return { ok: false, message: 'Add LiftLog to your Home Screen first, then turn this on from there.' };
  if (status === 'unsupported') return { ok: false, message: 'This browser doesn’t support notifications.' };
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      bump();
      return { ok: false, message: 'Notifications weren’t allowed. You can enable them in iPhone Settings → Notifications → LiftLog.' };
    }
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = (await fetch(FN_URL).then((r) => r.json())) as { publicKey: string };
    let sub = await reg.pushManager.getSubscription();
    if (sub && b64url(sub.options.applicationServerKey) !== publicKey) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64url(publicKey) });
    const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    const sb = await getSupabase()!;
    const { error } = await sb
      .from('push_subscriptions')
      .upsert({ endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth, user_agent: navigator.userAgent.slice(0, 200) }, { onConflict: 'endpoint' });
    if (error) throw error;
    putMeta('notifyEnabled', true);
    bump();
    void sendTestNotification();
    return { ok: true };
  } catch (e) {
    console.warn('[liftlog] enabling notifications failed', e);
    return { ok: false, message: 'Couldn’t turn on notifications. Check your connection and try again.' };
  }
}

export async function disableNotifications() {
  putMeta('notifyEnabled', false);
  bump();
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const sb = await getSupabase()!;
      await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      await sub.unsubscribe();
    }
  } catch {
    /* already gone */
  }
}

export async function sendTestNotification() {
  const token = getAccessToken();
  if (!token) return;
  await fetch(FN_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'test' }),
  }).catch(() => {});
}

/* ----------------------------- local notifications ----------------------------- */

export async function showLocal(tag: string, title: string, body: string) {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg?.showNotification(title, {
      body,
      tag,
      silent: true,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      data: { url: './#/workout' },
    });
  } catch {
    /* not permitted right now */
  }
}

export async function clearLocal(tags: string[]) {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    for (const tag of tags) (await reg.getNotifications({ tag })).forEach((n) => n.close());
  } catch {
    /* ignore */
  }
}

/* ------------------------------ server-scheduled push ------------------------------ */
// keepalive lets these requests finish even while iOS is suspending the page.

function restHeaders(token: string) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  };
}

export function scheduleRestPush(userId: string, dueAt: Date, title: string, body: string) {
  const token = getAccessToken();
  if (!token) return;
  void fetch(`${SUPABASE_URL}/rest/v1/notification_schedule?on_conflict=user_id,kind`, {
    method: 'POST',
    keepalive: true,
    headers: restHeaders(token),
    body: JSON.stringify({ user_id: userId, kind: 'rest', due_at: dueAt.toISOString(), title: title.slice(0, 120), body: body.slice(0, 300), sent_at: null }),
  }).catch(() => {});
}

export function cancelRestPush() {
  const token = getAccessToken();
  if (!token) return;
  void fetch(`${SUPABASE_URL}/rest/v1/notification_schedule?kind=eq.rest`, {
    method: 'DELETE',
    keepalive: true,
    headers: restHeaders(token),
  }).catch(() => {});
}
