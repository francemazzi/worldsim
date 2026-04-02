export interface GeoLocation {
  latitude: number;
  longitude: number;
  label?: string | undefined;
}

export interface LocationConfig {
  home?: GeoLocation | undefined;
  current?: GeoLocation | undefined;
}
