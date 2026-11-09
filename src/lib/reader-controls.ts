import { NativeModule, requireOptionalNativeModule } from "expo";

declare class ReaderControls extends NativeModule<{ onVolumeKey: (event: { direction: number }) => void }> {
  configure(active: boolean, keepAwake: boolean, brightness: number, volume: boolean): Promise<void>;
}

export const readerControls = requireOptionalNativeModule<ReaderControls>("NightShelfReaderControls");
