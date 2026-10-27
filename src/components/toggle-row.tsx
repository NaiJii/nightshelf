import { ActivityIndicator, Switch, Text, View } from "react-native";
import { Pressable } from "./pressable";
import { color, ui } from "./ui";

export function ToggleRow({ title, description, label = title, value, onValueChange, disabled = false, busy = false }: {
  title: string; description?: string; label?: string; value: boolean;
  onValueChange: (value: boolean) => void; disabled?: boolean; busy?: boolean;
}) {
  const blocked = disabled || busy;
  return <View style={{ width: "100%", flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingVertical: 6 }}>
    <Pressable accessible={false} importantForAccessibility="no-hide-descendants" disabled={blocked} onPress={() => onValueChange(!value)} style={{ flex: 1, minHeight: 48, justifyContent: "center", paddingVertical: 8 }}>
      <Text style={[ui.text, { opacity: blocked ? 0.5 : 1 }]}>{title}</Text>
      {description && <Text style={[ui.muted, { fontSize: 11, marginTop: 4 }]}>{description}</Text>}
    </Pressable>
    {busy && <ActivityIndicator accessibilityLabel="Updating setting" size="small" color={color.lilac} />}
    <Switch accessibilityLabel={label} accessibilityHint={description} disabled={blocked} value={value} onValueChange={onValueChange} trackColor={{ false: color.raised, true: color.purple }} thumbColor={value ? color.lilac : color.muted} />
  </View>;
}
