const { withMainActivity } = require("expo/config-plugins");

// CNG owns MainActivity. Apply the key hook on every generated build, never by hand.
module.exports = config => withMainActivity(config, config => {
  const marker = "// nightshelf-reader-volume";
  if (config.modResults.contents.includes(marker)) return config;
  if (config.modResults.language !== "kt") throw new Error("NightShelf reader controls require Kotlin MainActivity.");
  const start = /class MainActivity\s*:\s*ReactActivity\(\)\s*\{/;
  if (!start.test(config.modResults.contents)) throw new Error("Could not locate MainActivity for reader volume controls.");
  config.modResults.contents = config.modResults.contents.replace(start, match => `${match}
  ${marker}
  override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
    if (expo.modules.readercontrols.ReaderControlsModule.handleVolumeKey(event)) return true
    return super.dispatchKeyEvent(event)
  }
`);
  return config;
});
