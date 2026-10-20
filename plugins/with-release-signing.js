const { withAppBuildGradle } = require("expo/config-plugins");

// EAS supplies its own signing configuration. This is only enabled on our CI runner.
module.exports = config => {
  if (!process.env.NIGHTSHELF_KEYSTORE_PATH) return config;
  for (const key of ["NIGHTSHELF_STORE_PASSWORD", "NIGHTSHELF_KEY_ALIAS", "NIGHTSHELF_KEY_PASSWORD"]) {
    if (!process.env[key]) throw new Error(`Missing release signing environment: ${key}`);
  }
  return withAppBuildGradle(config, config => {
    const marker = "// nightshelf-release-signing";
    if (config.modResults.contents.includes(marker)) return config;
    if (config.modResults.language !== "groovy") throw new Error("NightShelf release signing requires Groovy build.gradle");
    config.modResults.contents += `
${marker}
android {
    signingConfigs {
        nightshelfRelease {
            storeFile file(System.getenv("NIGHTSHELF_KEYSTORE_PATH"))
            storePassword System.getenv("NIGHTSHELF_STORE_PASSWORD")
            keyAlias System.getenv("NIGHTSHELF_KEY_ALIAS")
            keyPassword System.getenv("NIGHTSHELF_KEY_PASSWORD")
        }
    }
    buildTypes.release.signingConfig = signingConfigs.nightshelfRelease
}
`;
    return config;
  });
};
