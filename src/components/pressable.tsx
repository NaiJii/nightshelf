import type { ComponentProps } from "react";
import { Pressable as NativePressable } from "react-native";

export function Pressable({ style, ...props }: ComponentProps<typeof NativePressable>) {
  return <NativePressable android_ripple={{ color: "#c9a7ff26" }} {...props} style={state => [
    typeof style === "function" ? style(state) : style,
    state.pressed && { opacity: 0.72 },
    (props.accessibilityState?.checked === true || props.accessibilityState?.selected === true) && { backgroundColor: "#8b5cf626", borderRadius: 12 },
  ]} />;
}
