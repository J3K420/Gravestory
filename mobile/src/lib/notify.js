// Local notifications — fire a "your story is ready" notification when a scan
// finishes while the app is backgrounded, and route a tap back to the result.
//
// LOCAL ONLY: no Expo push tokens, no remote push, no server. Every export is
// the single touchpoint for `expo-notifications` (screens/App.js never import it
// directly) — mirrors how api-*.js wrap their native deps.
//
// Design rules:
//   - NEVER throws into the caller, NEVER blocks a scan. A denied permission or
//     a thrown notification API just means we skip the notification; the scan
//     still completes and Result is ready on return. Everything is try/caught and
//     warns at most.
//   - The just-finished story is in-memory only at notify time (an unsaved scan
//     has no DB row yet), so we stash it on a module ref for the tap handler to
//     re-navigate to Result. After a cold app kill that ref is gone — the tap
//     handler then falls back to Home (the honest landing; the in-memory unsaved
//     story is unrecoverable, which is acceptable for the local-notify scope).

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

const CHANNEL_ID = 'scan-complete';
const TYPE_SCAN_COMPLETE = 'scan-complete';

// The most recent finished story, stashed so a notification tap can route to its
// Result screen without threading screen state through the notification payload.
// Lives only for the process lifetime — a cold start clears it (tap → Home).
// Keyed by timestamp so a tap on an OLDER notification (after a newer scan
// overwrote the slot, or after the story was already opened) doesn't route to
// the wrong story — see addStoryReadyTapListener.
let _lastReadyStory = null;

export function setLastReadyStory(story) {
  _lastReadyStory = story || null;
}

// Return the stashed story only if its timestamp matches the one the tapped
// notification carried, then consume it (clear the slot) so a second tap on the
// same/stale notification can't re-open an already-handled story. A mismatch
// (newer scan overwrote the slot, or it was already consumed) yields null → the
// caller lands on Home rather than the wrong story.
function takeReadyStoryFor(storyTimestamp) {
  const s = _lastReadyStory;
  if (s && storyTimestamp != null && s.timestamp === storyTimestamp) {
    _lastReadyStory = null;
    return s;
  }
  return null;
}

// Call once at app boot. Sets the foreground-presentation handler (SDK 54 uses
// shouldShowBanner/shouldShowList, NOT the deprecated shouldShowAlert) and, on
// Android, creates the notification channel. Idempotent and fail-soft.
export async function configureNotifications() {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'Story Ready',
        importance: Notifications.AndroidImportance.HIGH,
        // A short single buzz — a gentle "it's done" nudge. enableVibrate/
        // enableLights must be set explicitly or the pattern/color are inert.
        enableVibrate: true,
        vibrationPattern: [0, 200],
        enableLights: true,
        lightColor: '#f2b65c',
      });
    }
  } catch (e) {
    console.warn('configureNotifications failed (non-fatal):', e?.message);
  }
}

// Request notification permission. Returns true if granted. MAY show the OS
// prompt — call this only from the FOREGROUND (at scan start), never from a
// backgrounded path (a request while backgrounded is a no-op / undefined and
// can surface abruptly on return). Asks only when not already determined, so a
// user who already decided isn't re-prompted. Never throws.
export async function requestNotificationPermission() {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    // canAskAgain false → user permanently denied; don't nag, just bail.
    if (current.status === 'denied' && current.canAskAgain === false) return false;
    const next = await Notifications.requestPermissionsAsync();
    return !!next.granted;
  } catch (e) {
    console.warn('requestNotificationPermission failed (non-fatal):', e?.message);
    return false;
  }
}

// Check whether we already have permission. NEVER prompts — safe to call from a
// backgrounded path (notifyStoryReady). Returns false on any error.
async function hasNotificationPermission() {
  try {
    const current = await Notifications.getPermissionsAsync();
    return !!current.granted;
  } catch (e) {
    console.warn('hasNotificationPermission failed (non-fatal):', e?.message);
    return false;
  }
}

// Fire an immediate local "story ready" notification. No-op (warns) on any error
// or if permission isn't already granted — it only CHECKS permission (never
// prompts), because the caller fires this from the background. The caller decides
// WHEN to fire (only when the app is backgrounded — see CameraScreen).
export async function notifyStoryReady({ name, storyTimestamp } = {}) {
  try {
    const granted = await hasNotificationPermission();
    if (!granted) return;
    const who = (name && String(name).trim()) || 'Your story';
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Your story is ready ⚱',
        body: `${who}'s biography is complete — tap to read.`,
        data: { type: TYPE_SCAN_COMPLETE, storyTimestamp: storyTimestamp ?? null },
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
      },
      trigger: null, // immediate
    });
  } catch (e) {
    console.warn('notifyStoryReady failed (non-fatal):', e?.message);
  }
}

// Subscribe to notification taps. `onScanComplete(story)` is invoked when the
// user taps a scan-complete notification — with the matching stashed story if
// it's still in memory and its timestamp matches the tapped notification, else
// null (cold start, or a stale tap whose story was superseded/already opened).
// This listener ALSO receives the tap that COLD-LAUNCHED the app (per the
// expo-notifications response-listener contract), so it is the single handler
// for both warm and cold taps — no separate getLastNotificationResponseAsync
// probe is needed (that value is sticky and would mis-fire on later icon
// launches). Returns an unsubscribe fn. Fail-soft.
export function addStoryReadyTapListener(onScanComplete) {
  try {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      try {
        const data = response?.notification?.request?.content?.data;
        if (data?.type === TYPE_SCAN_COMPLETE) {
          onScanComplete(takeReadyStoryFor(data.storyTimestamp));
        }
      } catch (e) {
        console.warn('notification tap handler failed (non-fatal):', e?.message);
      }
    });
    return () => sub.remove();
  } catch (e) {
    console.warn('addStoryReadyTapListener failed (non-fatal):', e?.message);
    return () => {};
  }
}
