import * as Location from 'expo-location';
import { RestArea } from '../types';

export const CHECK_IN_RADIUS_KM = 0.5;

export async function requestLocationPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

export async function getCurrentLocation(): Promise<{ lat: number; lng: number } | null> {
  try {
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: loc.coords.latitude, lng: loc.coords.longitude };
  } catch {
    return null;
  }
}

export function distanceBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isNearRestArea(
  userLoc: { lat: number; lng: number },
  restArea: RestArea,
): boolean {
  return distanceBetween(userLoc.lat, userLoc.lng, restArea.lat, restArea.lng) <= CHECK_IN_RADIUS_KM;
}

export function getNearbyRestArea(
  userLoc: { lat: number; lng: number },
  restAreas: RestArea[],
): RestArea | null {
  return restAreas.find(r => isNearRestArea(userLoc, r)) ?? null;
}
