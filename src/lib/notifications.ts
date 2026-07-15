import { LocalNotifications } from '@capacitor/local-notifications';
import { getTodayInfo } from '@/lib/programEngine';
import { program } from '@/lib/data';

const ROLLING_WINDOW_DAYS = 55; // stays safely under iOS's 64-pending-notification cap
const CHANNEL_ID = 'training-reminders';

function sessionReminderBody(sessionKey: string): string {
  const session = program.sessions[sessionKey];
  const title = session?.title.split('—')[0].trim() ?? 'Training';
  return `${title} today. Time to train.`;
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

    const notifications: {
      id: number;
      title: string;
      body: string;
      schedule: { at: Date };
      channelId: string;
    }[] = [];
    const today = new Date();

    for (let i = 0; i < ROLLING_WINDOW_DAYS; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      date.setHours(hour, minute, 0, 0);
      if (date.getTime() <= Date.now()) continue; // don't schedule in the past

      const info = getTodayInfo(startIso, date);
      if (info.isRestDay || info.isProgramComplete) continue;

      notifications.push({
        id: i + 1,
        title: 'The Home Dumbbell Blueprint',
        body: sessionReminderBody(info.weeklyTemplateEntry.session_key),
        schedule: { at: date },
        channelId: CHANNEL_ID,
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
