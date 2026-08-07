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
  getDeveloperModeEnabled,
  setDeveloperModeEnabled as persistDeveloperModeEnabled,
  getVerboseLoggingEnabled,
  setVerboseLoggingEnabled as persistVerboseLoggingEnabled,
  getRecoveryTracingEnabled,
  setRecoveryTracingEnabled as persistRecoveryTracingEnabled,
} from "@/lib/db";
import {
  setRecoveryDebugEnabled,
  setRecoveryTracingEnabled,
} from "@/services/recovery/recoveryScore";

interface SettingsContextValue {
  loaded: boolean;
  notificationsEnabled: boolean;
  reminderTime: string;
  setNotificationsEnabled: (value: boolean) => Promise<void>;
  setReminderTime: (value: string) => Promise<void>;
  savePhotosToGallery: boolean;
  setSavePhotosToGallery: (value: boolean) => Promise<void>;
  developerMode: boolean;
  setDeveloperMode: (value: boolean) => Promise<void>;
  verboseLogging: boolean;
  setVerboseLogging: (value: boolean) => Promise<void>;
  recoveryTracing: boolean;
  setRecoveryTracing: (value: boolean) => Promise<void>;
  navRefreshKey: number;
  refreshNav: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [notificationsEnabled, setNotificationsEnabledState] = useState(false);
  const [reminderTime, setReminderTimeState] = useState("18:00");
  const [savePhotosToGallery, setSavePhotosToGalleryState] = useState(true);
  const [developerMode, setDeveloperModeState] = useState(false);
  const [verboseLogging, setVerboseLoggingState] = useState(false);
  const [recoveryTracing, setRecoveryTracingState] = useState(true);
  const [navRefreshKey, setNavRefreshKey] = useState(0);

  const refreshNav = useCallback(() => setNavRefreshKey((k) => k + 1), []);

  useEffect(() => {
    (async () => {
      const [
        enabled,
        time,
        savePhotos,
        devMode,
        verbose,
        tracing,
      ] = await Promise.all([
        getNotificationsEnabled(),
        getReminderTime(),
        getSavePhotosToGallery(),
        getDeveloperModeEnabled(),
        getVerboseLoggingEnabled(),
        getRecoveryTracingEnabled(),
      ]);
      setNotificationsEnabledState(enabled);
      setReminderTimeState(time);
      setSavePhotosToGalleryState(savePhotos);
      setDeveloperModeState(devMode);
      setVerboseLoggingState(verbose);
      setRecoveryTracingState(tracing);
      setRecoveryDebugEnabled(verbose);
      setRecoveryTracingEnabled(tracing);
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

  async function setDeveloperMode(value: boolean) {
    setDeveloperModeState(value);
    await persistDeveloperModeEnabled(value);
  }

  async function setVerboseLogging(value: boolean) {
    setVerboseLoggingState(value);
    setRecoveryDebugEnabled(value);
    await persistVerboseLoggingEnabled(value);
  }

  async function setRecoveryTracing(value: boolean) {
    setRecoveryTracingState(value);
    setRecoveryTracingEnabled(value);
    await persistRecoveryTracingEnabled(value);
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
        developerMode,
        setDeveloperMode,
        verboseLogging,
        setVerboseLogging,
        recoveryTracing,
        setRecoveryTracing,
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
