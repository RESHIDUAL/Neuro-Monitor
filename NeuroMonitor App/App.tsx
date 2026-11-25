// Neuro Monitor: app shell with consent gate and bottom navigation (dark bar, like the reference sidebar).
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AppProvider, useApp } from './src/state';
import { C } from './src/theme';
import { Screen, Card, Btn, Small } from './src/ui/kit';
import HomeScreen from './src/screens/HomeScreen';
import TestScreen from './src/screens/TestScreen';
import LiveScreen from './src/screens/LiveScreen';
import MedsScreen from './src/screens/MedsScreen';
import ReportScreen from './src/screens/ReportScreen';
import MoreScreen from './src/screens/MoreScreen';

const TABS = [
  { id: 'home', label: 'Home' },
  { id: 'test', label: 'Test' },
  { id: 'live', label: 'Live' },
  { id: 'meds', label: 'Meds' },
  { id: 'report', label: 'Report' },
  { id: 'more', label: 'More' },
];

function Consent() {
  const { update } = useApp();
  return (
    <Screen title="Neuro Monitor" subtitle="Wearable movement monitoring prototype">
      <Card color={C.yellow} title="Before you continue">
        <Small>This app is an academic screening and monitoring prototype.</Small>
        <Small>· Screening aid only. Not a diagnosis.</Small>
        <Small>· It cannot diagnose Parkinson's disease, essential tremor or epilepsy.</Small>
        <Small>· "Seizure-like" results come from a model trained on acted seizures. They are not confirmed seizures, and this is not a life-safety device.</Small>
        <Small>· It never recommends changing medication or doses.</Small>
        <Small>· All data stays on this phone.</Small>
      </Card>
      <Btn title="I understand and consent" onPress={() => update('consentAt', String(Date.now()))} />
    </Screen>
  );
}

function Shell() {
  const { ready, settings } = useApp();
  const [tab, setTab] = useState('home');
  if (!ready) return <View style={{ flex: 1, backgroundColor: C.bg }} />;
  if (!settings.consentAt) return <Consent />;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flex: 1 }}>
        {tab === 'home' && <HomeScreen go={setTab} />}
        {/* The Test screen stays mounted so a running test continues if you open another tab. */}
        <View style={{ flex: 1, display: tab === 'test' ? 'flex' : 'none' }}><TestScreen /></View>
        {tab === 'live' && <LiveScreen />}
        {tab === 'meds' && <MedsScreen />}
        {tab === 'report' && <ReportScreen />}
        {tab === 'more' && <MoreScreen />}
      </View>
      <View style={{ position: 'absolute', left: 12, right: 12, bottom: 16, backgroundColor: C.nav, borderRadius: 26, flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 6 }}>
        {TABS.map((t) => (
          <Pressable key={t.id} onPress={() => setTab(t.id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 18, backgroundColor: tab === t.id ? C.accent : 'transparent' }}>
            <Text style={{ color: tab === t.id ? C.white : C.navText, fontWeight: '700', fontSize: 12 }}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function App() {
  return (
    <AppProvider>
      <StatusBar style="dark" />
      <Shell />
    </AppProvider>
  );
}
