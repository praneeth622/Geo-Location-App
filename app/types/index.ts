export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  isAdmin: boolean;
  createdAt: string;
  deviceInfo: DeviceInfo;
  lastLogin: string;
  status: string;
  biometricEnabled: boolean;
  biometricAttempts: any[];
  checkInHistory: any[];
  checkedIn: boolean;
}

export interface DeviceInfo {
  brand: string;
  modelName: string;
  osName: string;
  osVersion: string;
  deviceId: string;
  imei: string[];
}

export interface AttendanceRecord {
  id: string;
  userId: string;
  timestamp: string;
  type: 'check-in' | 'check-out';
  location?: {
    latitude: number;
    longitude: number;
  };
}

export interface ProcessedAttendanceRecord {
  userId: string;
  userName: string;
  userEmail: string;
  date: string;
  checkIn: AttendanceRecord | null;
  checkOut: AttendanceRecord | null;
  duration?: number;
}

export interface UserStats {
  name: string;
  email: string;
  totalMinutesToday: number;
  totalHoursToday: number;
  totalMinutesAllTime: number;
  totalHoursAllTime: number;
}

export interface DashboardStats {
  totalUsers: number;
  checkedInUsers: number;
  todayAttendance: number;
  avgHoursToday: number;
}

export interface OfficeLocation {
  latitude: string;
  longitude: string;
  radius: string;
} 