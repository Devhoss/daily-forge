import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  getNotificationsEnabled,
  setNotificationsEnabled as persistNotificationsEnabled,
  getReminderTime,
  setReminderTime as persistReminderTime,
} from "@/lib/db";

interface SettingsContextValue {
  loaded: boolean;
  notificationsEnabled: boolean;
  reminderTime: string;
  setNotificationsEnabled: (value: boolean) => Promise<void>;
  setReminderTime: (value: string) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [notificationsEnabled, setNotificationsEnabledState] = useState(false);
  const [reminderTime, setReminderTimeState] = useState("18:00");

  useEffect(() => {
    (async () => {
      const [enabled, time] = await Promise.all([
        getNotificationsEnabled(),
        getReminderTime(),
      ]);
      setNotificationsEnabledState(enabled);
      setReminderTimeState(time);
      setLoaded(true);
    })();
  }, []);

  async function setNotificationsEnabled(value: boolean) {
    setNotificationsEnabledState(value);
    await persistNotificationsEnabled(value);
  }

  async function setReminderTime(value: string) {
    setReminderTimeState(value);
    await persistReminderTime(value);
  }

  return (
    <SettingsContext.Provider
      value={{
        loaded,
        notificationsEnabled,
        reminderTime,
        setNotificationsEnabled,
        setReminderTime,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx)
    throw new Error("useSettings must be used within <SettingsProvider>");
  return ctx;
}
