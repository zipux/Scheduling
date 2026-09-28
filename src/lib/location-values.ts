/** Form state for a location (strings as typed); shared by server pages and client forms. */
export interface LocationValues {
  name: string;
  address: string;
  timezone: string;
  lat: string;
  lng: string;
  radiusM: string;
  geofenceMode: "required" | "warn" | "off";
  isTemporary: boolean;
}

export function emptyLocation(timezone: string): LocationValues {
  return { name: "", address: "", timezone, lat: "", lng: "", radiusM: "100", geofenceMode: "warn", isTemporary: false };
}
