// Bridge to the iPhone app's Apple Health sync (ios/App/App/HealthSync.swift).
// On the website these are never called: isNative() is false there.
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface HealthStatus { available: boolean; connected: boolean; lastSync?: string; lastCount: number }
interface HealthSyncPlugin {
  status(): Promise<HealthStatus>;
  connect(o: { endpoint: string }): Promise<{ sent: number }>;
  syncNow(): Promise<{ sent: number }>;
  disconnect(): Promise<void>;
}

export const HealthSync = registerPlugin<HealthSyncPlugin>('HealthSync');
export const isNative = () => Capacitor.isNativePlatform();
