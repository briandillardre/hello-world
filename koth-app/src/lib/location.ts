import * as Location from 'expo-location';
import { RestArea } from '../types';

export interface UserLocation {
  lat: number;
  lng: number;
}

export async function requestLocationPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

export async function getCurrentLocation(): Promise<UserLocation | null> {
  try {
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return { lat: location.coords.latitude, lng: location.coords.longitude };
  } catch {
    return null;
  }
}

// Haversine distance in km
export function distanceBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const CHECK_IN_RADIUS_KM = 0.5;

export function isNearRestArea(userLoc: UserLocation, restArea: RestArea): boolean {
  return distanceBetween(userLoc.lat, userLoc.lng, restArea.lat, restArea.lng) <= CHECK_IN_RADIUS_KM;
}

export function getNearbyRestArea(
  userLoc: UserLocation,
  restAreas: RestArea[],
): RestArea | null {
  for (const ra of restAreas) {
    if (isNearRestArea(userLoc, ra)) return ra;
  }
  return null;
}
