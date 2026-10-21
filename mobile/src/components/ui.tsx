import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const colors = {
  bg: '#F6F5FB',
  card: '#FFFFFF',
  text: '#16141F',
  muted: '#6B6880',
  border: '#E6E3F0',
  primary: '#5B4BFF',
  primarySoft: '#ECE9FF',
  danger: '#E5484D',
  dangerSoft: '#FDECEC',
  success: '#2F9E62',
  warning: '#B7791F',
  warningSoft: '#FFF5E1',
};

export function Screen({ children, scroll = true, edges }: { children: ReactNode; scroll?: boolean; edges?: ('top' | 'bottom')[] }) {
  return (
    <SafeAreaView style={styles.screen} edges={edges ?? ['bottom']}>
      {scroll ? <ScrollView contentContainerStyle={styles.scroll}>{children}</ScrollView> : children}
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Body({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: object }) {
  return <Text style={[styles.body, muted && { color: colors.muted }, style]}>{children}</Text>;
}

export function Section({ title, children, footer }: { title?: string; children: ReactNode; footer?: string }) {
  return (
    <View style={{ marginBottom: 20 }}>
      {title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
      <View style={styles.card}>{children}</View>
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </View>
  );
}

export function Row({
  title,
  subtitle,
  right,
  onPress,
  last,
}: {
  title: string;
  subtitle?: string | null;
  right?: ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.row, !last && styles.rowBorder, pressed && { opacity: 0.6 }]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </Pressable>
  );
}

export function ToggleRow({ title, subtitle, value, onChange, last }: { title: string; subtitle?: string; value: boolean; onChange: (v: boolean) => void; last?: boolean }) {
  return <Row title={title} subtitle={subtitle} last={last} right={<Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary }} />} />;
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  loading,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const palette = {
    primary: { bg: colors.primary, fg: '#fff' },
    secondary: { bg: colors.primarySoft, fg: colors.primary },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
    ghost: { bg: 'transparent', fg: colors.primary },
  }[kind];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [styles.button, { backgroundColor: palette.bg, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 }, style]}
    >
      {loading ? <ActivityIndicator color={palette.fg} /> : <Text style={[styles.buttonText, { color: palette.fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Chips<T>({ options, value, onChange }: { options: { label: string; value: T }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable key={o.label} onPress={() => onChange(o.value)} style={[styles.chip, selected && styles.chipSelected]}>
            <Text style={[styles.chipText, selected && { color: '#fff' }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Badge({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' }) {
  const bg = { neutral: colors.primarySoft, success: '#E3F5EA', warning: colors.warningSoft, danger: colors.dangerSoft }[tone];
  const fg = { neutral: colors.primary, success: colors.success, warning: colors.warning, danger: colors.danger }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{text}</Text>
    </View>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' }) {
  return (
    <View style={[styles.notice, tone === 'warning' && { backgroundColor: colors.warningSoft }]}>
      <Text style={[styles.body, { fontSize: 14 }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 28, fontWeight: '700', color: colors.text, marginBottom: 8 },
  body: { fontSize: 16, lineHeight: 22, color: colors.text },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: colors.muted, textTransform: 'uppercase', marginBottom: 6, marginLeft: 4 },
  footer: { fontSize: 13, color: colors.muted, marginTop: 6, marginHorizontal: 4, lineHeight: 18 },
  card: { backgroundColor: colors.card, borderRadius: 14, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowTitle: { fontSize: 16, color: colors.text, fontWeight: '500' },
  rowSubtitle: { fontSize: 13, color: colors.muted, marginTop: 2 },
  button: { height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.primarySoft },
  chipSelected: { backgroundColor: colors.primary },
  chipText: { color: colors.primary, fontWeight: '600' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  notice: { backgroundColor: colors.primarySoft, borderRadius: 12, padding: 14, marginBottom: 16 },
});
