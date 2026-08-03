import {
  createContext,
  useCallback,
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
  getSavePhotosToGallery,
  setSavePhotosToGallery as persistSavePhotosToGallery,
} from "@/lib/db";

interface SettingsContextValue {
  loaded: boolean;
  notificationsEnabled: boolean;
  reminderTime: string;
  setNotificationsEnabled: (value: boolean) => Promise<void>;
  setReminderTime: (value: string) => Promise<void>;
  savePhotosToGallery: boolean;
  setSavePhotosToGallery: (value: boolean) => Promise<void>;
  navRefreshKey: number;
  refreshNav: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [notificationsEnabled, setNotificationsEnabledState] = useState(false);
  const [reminderTime, setReminderTimeState] = useState("18:00");
  const [savePhotosToGallery, setSavePhotosToGalleryState] = useState(true);
  const [navRefreshKey, setNavRefreshKey] = useState(0);

  const refreshNav = useCallback(() => setNavRefreshKey((k) => k + 1), []);

  useEffect(() => {
    (async () => {
      const [enabled, time, savePhotos] = await Promise.all([
        getNotificationsEnabled(),
        getReminderTime(),
        getSavePhotosToGallery(),
      ]);
      setNotificationsEnabledState(enabled);
      setReminderTimeState(time);
      setSavePhotosToGalleryState(savePhotos);
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

  async function setSavePhotosToGallery(value: boolean) {
    setSavePhotosToGalleryState(value);
    await persistSavePhotosToGallery(value);
  }

  return (
    <SettingsContext.Provider
      value={{
        loaded,
        notificationsEnabled,
        reminderTime,
        setNotificationsEnabled,
        setReminderTime,
        savePhotosToGallery,
        setSavePhotosToGallery,
        navRefreshKey,
        refreshNav,
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
