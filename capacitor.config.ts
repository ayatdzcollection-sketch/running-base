import type { CapacitorConfig } from '@capacitor/cli';

// The iPhone app: the same web app, bundled, plus native Apple Health sync
// (ios/App/App/HealthSync.swift).
const config: CapacitorConfig = {
  appId: 'com.boumarafi.bulletproofbase',
  appName: 'Bulletproof Base',
  webDir: 'dist-native',
  ios: {
    contentInset: 'never',
    backgroundColor: '#F4F4F1',
  },
};

export default config;
