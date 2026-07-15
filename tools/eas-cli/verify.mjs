import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { EasJsonAccessor, EasJsonUtils, Platform } = require('@expo/eas-json');
const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'mobile');
const accessor = EasJsonAccessor.fromProjectPath(projectDir);

const cli = await EasJsonUtils.getCliConfigAsync(accessor);
if (cli?.version !== '21.0.0') throw new Error('eas.json must require EAS CLI 21.0.0');

const expectedProfiles = ['development', 'phase9', 'preview', 'production'];
const profiles = await EasJsonUtils.getBuildProfileNamesAsync(accessor);
for (const profile of expectedProfiles) {
  if (!profiles.includes(profile)) throw new Error(`Missing EAS build profile: ${profile}`);
  await EasJsonUtils.getBuildProfileAsync(accessor, Platform.ANDROID, profile);
}
await EasJsonUtils.getSubmitProfileAsync(accessor, Platform.ANDROID, 'production');

console.log(`Validated ${expectedProfiles.length} Android EAS build profiles and the production submit profile locally.`);
