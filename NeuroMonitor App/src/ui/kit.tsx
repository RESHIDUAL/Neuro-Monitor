// Small shared UI pieces used by every screen.
import { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { C, R } from '../theme';
import type { DataSource } from '../stream/hub';
import { sourceLabel } from '../stream/hub';

export function Screen({ title, subtitle, children, right }: { title: string; subtitle?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 110 }} keyboardShouldPersistTaps="handled">
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{title}</Text>
          {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
      {children}
    </ScrollView>
  );
}

export function Card({ color = C.white, title, children, style }: { color?: string; title?: string; children: ReactNode; style?: ViewStyle }) {
  return (
    <View style={[s.card, { backgroundColor: color }, style]}>
      {title ? <Text style={s.cardTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

export function Btn({ title, onPress, kind = 'dark', disabled }: { title: string; onPress: () => void; kind?: 'dark' | 'light' | 'accent'; disabled?: boolean }) {
  const bg = kind === 'dark' ? C.nav : kind === 'accent' ? C.accent : C.white;
  const fg = kind === 'light' ? C.ink : C.white;
  return (
    <Pressable onPress={onPress} disabled={disabled}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 }, kind === 'light' && s.btnLight]}>
      <Text style={[s.btnText, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, selected && { backgroundColor: C.nav }]}>
      <Text style={[s.chipText, selected && { color: C.white }]}>{label}</Text>
    </Pressable>
  );
}

export function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, bold && { fontSize: 15 }]}>{value}</Text>
    </View>
  );
}

export function Small({ children, color }: { children: ReactNode; color?: string }) {
  return <Text style={[s.small, color ? { color } : null]}>{children}</Text>;
}

export function Disclaimer() {
  return <Text style={s.disclaimer}>Screening aid only. Not a diagnosis.</Text>;
}

// Shows where the data and the prediction came from. Drawn from stored fields, never hard-coded.
export function ProvenanceBadges({ source, profileShort, simulatedPrediction }: { source: DataSource | null; profileShort?: string; simulatedPrediction?: boolean }) {
  const synthetic = source === 'DEMO' || source === 'SIMULATOR';
  return (
    <View style={s.badges}>
      <Badge text={sourceLabel(source)} tone={synthetic ? 'warn' : source ? 'ok' : 'muted'} />
      {profileShort ? <Badge text={`MODEL · ${profileShort}`} tone={profileShort.includes('confirmed') ? 'ok' : 'warn'} /> : null}
      {simulatedPrediction ? <Badge text="SIMULATED PREDICTION" tone="warn" /> : null}
    </View>
  );
}

export function Badge({ text, tone = 'muted' }: { text: string; tone?: 'ok' | 'warn' | 'muted' | 'danger' }) {
  const bg = tone === 'ok' ? '#DDEBC8' : tone === 'warn' ? '#FFE7B3' : tone === 'danger' ? '#FFD3D3' : C.cream;
  return <Text style={[s.badge, { backgroundColor: bg }]}>{text}</Text>;
}

export function ProbBar({ label, value, color = C.nav }: { label: string; value: number; color?: string }) {
  return (
    <View style={{ marginVertical: 4 }}>
      <View style={s.row}>
        <Text style={s.rowLabel}>{label}</Text>
        <Text style={s.rowValue}>{Math.round(value * 100)}%</Text>
      </View>
      <View style={s.barBg}><View style={[s.barFill, { width: `${Math.max(0, Math.min(1, value)) * 100}%`, backgroundColor: color }]} /></View>
    </View>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 18 },
  header: { flexDirection: 'row', alignItems: 'flex-start', paddingTop: 50, paddingBottom: 6 },
  title: { fontSize: 28, fontWeight: '800', color: C.ink },
  subtitle: { fontSize: 14, color: C.muted, marginTop: 4, lineHeight: 20 },
  card: { borderRadius: R.card, padding: 16, marginTop: 14 },
  cardTitle: { fontSize: 18, fontWeight: '800', color: C.ink, marginBottom: 8 },
  btn: { borderRadius: R.pill, paddingVertical: 13, paddingHorizontal: 18, alignItems: 'center', marginTop: 10 },
  btnLight: { borderWidth: 1, borderColor: C.line },
  btnText: { fontSize: 15, fontWeight: '700' },
  chip: { borderRadius: R.pill, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: C.white, marginRight: 8, marginTop: 8, borderWidth: 1, borderColor: C.line },
  chipText: { fontSize: 13, fontWeight: '600', color: C.ink },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, gap: 12 },
  rowLabel: { fontSize: 13, color: '#333', flexShrink: 1 },
  rowValue: { fontSize: 13, fontWeight: '700', color: C.ink, flexShrink: 1, textAlign: 'right' },
  small: { fontSize: 12, color: '#3D3A33', lineHeight: 17 },
  disclaimer: { fontSize: 12, color: C.warn, fontWeight: '600', marginTop: 4 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  badge: { fontSize: 11, fontWeight: '700', color: C.ink, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, overflow: 'hidden' },
  barBg: { height: 8, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.12)', overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
});
