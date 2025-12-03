
export enum LogLevel {
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  SUCCESS = 'SUCCESS',
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  details?: string;
  source?: 'SYSTEM' | 'AD';
}

export interface EnvironmentInfo {
  userAgent: string;
  platform: string;
  isIOS: boolean;
  isAndroid: boolean;
  isWebView: boolean;
  hasMraid: boolean;
  screenSize: string;
}

export interface RedirectConfig {
  androidPackageId: string;
  iosAppId: string;
}

export type DeviceType = 'IPHONE_14' | 'IPHONE_15_PRO' | 'PIXEL_7' | 'S24_ULTRA' | 'IPAD_AIR' | 'IPAD_PRO' | 'FULL';

export interface SimulatorConfig {
  device: DeviceType;
  orientation: 'PORTRAIT' | 'LANDSCAPE';
}

export type AdNetwork = 'AppLovin' | 'Google Ads' | 'IronSource' | 'Snapchat' | 'Unity Ads' | 'Unknown';

declare global {
  interface Window {
    mraid?: {
      open: (url: string) => void;
      getState: () => string;
      addEventListener: (event: string, listener: (args: any) => void) => void;
      removeEventListener: (event: string, listener: (args: any) => void) => void;
      isViewable: () => boolean;
    };
  }
}