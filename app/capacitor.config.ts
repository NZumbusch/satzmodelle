import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ch.zumbusch.satzmodelle',
  appName: 'Satzmodelle',
  webDir: 'dist',
  android: {
    // content is local only; never allow cleartext or mixed content
    allowMixedContent: false,
  },
};

export default config;
