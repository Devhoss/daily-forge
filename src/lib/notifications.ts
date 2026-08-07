import type { LocalNotificationSchema } from '@capacitor/local-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';
import { getTodayInfo } from '@/lib/programEngine';
import { program } from '@/lib/data';
import {
  getAllSessionLogs,
  getAllSetLogs,
  getAllMeasurements,
} from '@/lib/db';
import { getEquipmentProfile } from '@/lib/equipment';
import { buildDailyNotifications } from '@/services/notifications/notificationEngine';

const ROLLING_WINDOW_DAYS = 55; // stays safely under iOS's 64-pending-notification cap
const CHANNEL_ID = 'training-reminders';
const SMALL_ICON = 'ic_notification';
const ICON_COLOR = '#3B82F6'; // blue-500
const COACHED_ID_BASE = 900000; // id range reserved for coached notifications

function sessionReminderBody(sessionKey: string): string {
  const session = program.sessions[sessionKey];
  const title = session?.title.split('—')[0].trim() ?? 'Training';
  return `Today's workout: ${title}. Time to train.`;
}

/** Android 8+ (API 26+) requires every notification to belong to a channel,
 * or it can be silently dropped by the OS even when schedule() resolves
 * successfully and permissions are granted — this is the #1 cause of
 * "scheduled but never received" on Android. No-ops harmlessly on iOS/web. */
async function ensureAndroidChannel(): Promise<void> {
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: 'Training Reminders',
      description: 'Daily reminder on scheduled training days',
      importance: 5, // IMPORTANCE_HIGH — shows as a heads-up notification
      visibility: 1,
    });
    console.log('[notifications] Android channel ensured:', CHANNEL_ID);
  } catch (e) {
    console.log('[notifications] createChannel skipped/failed (expected on iOS/web):', e);
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const before = await LocalNotifications.checkPermissions();
    console.log('[notifications] checkPermissions before request:', before);

    const result = await LocalNotifications.requestPermissions();
    console.log('[notifications] requestPermissions result:', result);

    const granted = result.display === 'granted';
    if (!granted) {
      console.warn('[notifications] permission NOT granted — result was:', result.display);
    }
    return granted;
  } catch (e) {
    console.error('[notifications] requestNotificationPermission threw:', e);
    return false;
  }
}

/** Fires a single notification 30 seconds from now, independent of any
 * program/session logic — use this to verify the notification system
 * itself works before debugging the daily-reminder scheduling logic. */
export async function scheduleTestNotification(): Promise<void> {
  await ensureAndroidChannel();
  const granted = await requestNotificationPermission();
  console.log('[notifications] TEST: permission granted?', granted);
  if (!granted) {
    console.error('[notifications] TEST: aborting, permission not granted');
    return;
  }

  const at = new Date(Date.now() + 30_000);
  const testNotification = {
    id: 999999,
    title: 'Test Notification',
    body: `Scheduled at ${new Date().toLocaleTimeString()}, should fire at ${at.toLocaleTimeString()}`,
    schedule: { at },
    channelId: CHANNEL_ID,
    smallIcon: SMALL_ICON,
    iconColor: ICON_COLOR,
  };
  console.log('[notifications] TEST: scheduling', JSON.stringify(testNotification));

  try {
    await LocalNotifications.schedule({ notifications: [testNotification] });
  } catch (e) {
    console.error('[notifications] TEST: schedule() threw:', e);
    return;
  }

  const pending = await LocalNotifications.getPending();
  console.log('[notifications] TEST: getPending() after scheduling:', JSON.stringify(pending));
  if (pending.notifications.length === 0) {
    console.error(
      '[notifications] TEST: getPending() is EMPTY right after scheduling. ' +
      'This means schedule() silently failed. Common causes: (1) app was not rebuilt/synced ' +
      'after adding @capacitor/local-notifications — run `npm run cap:sync` and reinstall the ' +
      'app on device, not just refresh; (2) exact-alarm permission required on Android 12+ ' +
      '(SCHEDULE_EXACT_ALARM) not granted — check app battery/alarm settings; (3) OEM battery ' +
      'optimization (esp. Samsung/Xiaomi/Huawei) killing scheduling — disable battery ' +
      'optimization for this app.'
    );
  }
}

/** Cancels all pending reminders and re-schedules a fresh rolling window
 * starting today. Safe to call every time the app opens or the reminder
 * time is changed.
 * @param reminderTime "HH:MM" 24-hour, e.g. "07:30" or "18:00" */
export async function refreshDailyReminders(
  startIso: string,
  reminderTime: string = '18:00'
): Promise<void> {
  await ensureAndroidChannel();

  const [hourStr, minuteStr] = reminderTime.split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  try {
    const pendingBefore = await LocalNotifications.getPending();
    console.log('[notifications] getPending() before refresh:', pendingBefore.notifications.length);
    if (pendingBefore.notifications.length > 0) {
      await LocalNotifications.cancel({ notifications: pendingBefore.notifications });
    }

    const notifications: LocalNotificationSchema[] = [];
    const today = new Date();

    // Today's notification comes from the NotificationEngine (pure service):
    // it decides whether anything is important enough to interrupt and formats
    // a self-explaining payload. If it returns nothing, fall back to the plain
    // training reminder (or nothing on rest days).
    const [sessionLogs, setLogs, measurements, equipment] = await Promise.all([
      getAllSessionLogs(),
      getAllSetLogs(),
      getAllMeasurements(),
      getEquipmentProfile(),
    ]);
    const coached = buildDailyNotifications(sessionLogs, setLogs, measurements, {
      startIso,
      asOf: today,
      reminderTime,
      availableWeights: equipment.dumbbells,
    });
    const coachedScheduledFor = coached.length > 0 ? new Date(coached[0].scheduledFor).getTime() : 0;
    const useCoachedToday = coachedScheduledFor > Date.now();
    if (coached.length > 0 && useCoachedToday) {
      const n = coached[0];
      notifications.push({
        id: COACHED_ID_BASE + 1,
        title: n.title,
        body: n.body,
        schedule: { at: new Date(n.scheduledFor) },
        channelId: CHANNEL_ID,
        smallIcon: SMALL_ICON,
        iconColor: ICON_COLOR,
      });
    }

    const windowStart = useCoachedToday ? 1 : 0;
    for (let i = windowStart; i < ROLLING_WINDOW_DAYS; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      date.setHours(hour, minute, 0, 0);
      if (date.getTime() <= Date.now()) continue; // don't schedule in the past

      const info = getTodayInfo(startIso, date);
      if (info.isRestDay || info.isProgramComplete) continue;

      notifications.push({
        id: i + 1,
        title: 'DailyForge',
        body: sessionReminderBody(info.weeklyTemplateEntry.session_key),
        schedule: { at: date },
        channelId: CHANNEL_ID,
        smallIcon: SMALL_ICON,
        iconColor: ICON_COLOR,
      });
    }

    console.log(
      `[notifications] Built ${notifications.length} notifications at ${reminderTime} for the next ${ROLLING_WINDOW_DAYS} days:`,
      JSON.stringify(notifications, null, 2)
    );

    if (notifications.length > 0) {
      await LocalNotifications.schedule({ notifications });
    } else {
      console.warn('[notifications] No notifications to schedule (all rest days / program complete?)');
    }

    const pendingAfter = await LocalNotifications.getPending();
    console.log('[notifications] getPending() after schedule():', JSON.stringify(pendingAfter));
    if (notifications.length > 0 && pendingAfter.notifications.length === 0) {
      console.error(
        '[notifications] Scheduled', notifications.length,
        'notifications but getPending() shows 0 — schedule() silently failed. ' +
        'Run scheduleTestNotification() to isolate whether this is a general plugin/permission ' +
        'issue or something specific to this scheduling logic.'
      );
    }
  } catch (e) {
    console.error('[notifications] refreshDailyReminders threw:', e);
  }
}

/** Recompute today's coached notification from the latest data and reschedule
 * it. Much cheaper than `refreshDailyReminders` (which rebuilds the whole
 * rolling window) — call this when workout/measurement data changes so an
 * already-scheduled notification never stays stale. No-ops when nothing is
 * worth interrupting or the slot has already fired today. */
export async function refreshTodayCoachedNotification(
  startIso: string,
  reminderTime: string = '18:00',
): Promise<void> {
  try {
    const [sessionLogs, setLogs, measurements, equipment] = await Promise.all([
      getAllSessionLogs(),
      getAllSetLogs(),
      getAllMeasurements(),
      getEquipmentProfile(),
    ]);
    const coached = buildDailyNotifications(sessionLogs, setLogs, measurements, {
      startIso,
      asOf: new Date(),
      reminderTime,
      availableWeights: equipment.dumbbells,
    });
    const scheduledFor = coached.length > 0 ? new Date(coached[0].scheduledFor).getTime() : 0;
    const useCoached = coached.length > 0 && scheduledFor > Date.now();

    await LocalNotifications.cancel({ notifications: [{ id: COACHED_ID_BASE + 1 }] }).catch(() => {});
    if (!useCoached) return;

    const n = coached[0];
    await LocalNotifications.schedule({
      notifications: [
        {
          id: COACHED_ID_BASE + 1,
          title: n.title,
          body: n.body,
          schedule: { at: new Date(n.scheduledFor) },
          channelId: CHANNEL_ID,
          smallIcon: SMALL_ICON,
          iconColor: ICON_COLOR,
        },
      ],
    });
  } catch (e) {
    console.error('[notifications] refreshTodayCoachedNotification threw:', e);
  }
}

export async function cancelAllReminders(): Promise<void> {
  try {
    const pending = await LocalNotifications.getPending();
    console.log('[notifications] cancelAllReminders: cancelling', pending.notifications.length);
    if (pending.notifications.length > 0) {
      await LocalNotifications.cancel({ notifications: pending.notifications });
    }
  } catch (e) {
    console.error('[notifications] cancelAllReminders threw:', e);
  }
}
