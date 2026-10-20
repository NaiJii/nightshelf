import { Pressable } from "./pressable";
import { useState } from "react";
import { Text, View } from "react-native";
import { color } from "./ui";

const textStyle = { color: "#d8d2e2", fontSize: 14, lineHeight: 23 };
export function ExpandableSummary({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  return <View style={{ marginTop: 16 }}>
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: "absolute", top: 0, left: 0, right: 0, opacity: 0 }}>
      <Text style={textStyle} onTextLayout={event => setOverflows(event.nativeEvent.lines.length > 4)}>{text}</Text>
    </View>
    <Text numberOfLines={expanded && overflows ? undefined : 4} style={textStyle}>{text}</Text>
    {overflows && <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={{ paddingVertical: 12 }}><Text style={{ color: color.lilac }}>{expanded ? "Show less" : "Read summary"}</Text></Pressable>}
  </View>;
}
