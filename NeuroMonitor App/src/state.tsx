// App-wide state: settings (persisted in SQLite) and the stream hub start-up.
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { loadSettings, saveSetting, Settings, DEFAULT_SETTINGS } from './data/db';
import { hub, HubStatus } from './stream/hub';
import { setSensorScale } from './protocol/units';

type Ctx = {
  settings: Settings;
  ready: boolean;
  update: <K extends keyof Settings>(k: K, v: Settings[K]) => Promise<void>;
  dataVersion: number; // bumps when sessions or doses change, so screens reload
  bump: () => void;
};

const AppCtx = createContext<Ctx>({
  settings: DEFAULT_SETTINGS, ready: false, update: async () => {}, dataVersion: 0, bump: () => {},
});

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setSensorScale(s.scale);
      hub.demoMode = s.demoMode;
      hub.start(s.sourceKind);
      setReady(true);
    }).catch(() => { hub.start('udp'); setReady(true); });
  }, []);

  async function update<K extends keyof Settings>(k: K, v: Settings[K]) {
    setSettings((prev) => ({ ...prev, [k]: v })); // update the screen first so typing never drops letters
    saveSetting(k, v).catch(() => {});
    if (k === 'scale') setSensorScale(v as Settings['scale']);
    if (k === 'demoMode') hub.demoMode = v as Settings['demoMode'];
    if (k === 'sourceKind') hub.start(v as Settings['sourceKind']);
  }

  return (
    <AppCtx.Provider value={{ settings, ready, update, dataVersion, bump: () => setDataVersion((x) => x + 1) }}>
      {children}
    </AppCtx.Provider>
  );
}

export const useApp = () => useContext(AppCtx);

export function useHubStatus(): HubStatus {
  const [s, setS] = useState<HubStatus>(hub.getStatus());
  useEffect(() => hub.onStatus(setS), []);
  return s;
}
