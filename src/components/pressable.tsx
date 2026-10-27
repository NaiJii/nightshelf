import type { ComponentProps } from "react";
import { Pressable as NativePressable } from "react-native";

export function Pressable({ style, ...props }: ComponentProps<typeof NativePressable>) {
  return <NativePressable pressRetentionOffset={8} android_ripple={{ color: "#c9a7ff26" }} {...props} onPress={props.onPress ? event => { event?.stopPropagation(); props.onPress?.(event); } : undefined} onLongPress={props.onLongPress ? event => { event?.stopPropagation(); props.onLongPress?.(event); } : undefined} style={state => [
    typeof style === "function" ? style(state) : style,
    state.pressed && { opacity: 0.72 },
  ]} />;
}
