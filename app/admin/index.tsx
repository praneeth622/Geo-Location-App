import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl, 
  TextInput, TouchableOpacity, Alert, ActivityIndicator,
  SafeAreaView
} from 'react-native';
import {
  collection, query, orderBy, getDocs, doc, setDoc, getDoc,
  updateDoc
} from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { 
  MapPin, Save, Users, AlertTriangle, Smartphone, LogOut,
  Clock, Settings, BarChart3, ChevronRight, Calendar, 
  Shield, Home, User as UserIcon
} from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { signOut } from 'firebase/auth';
import { User, AttendanceRecord, ProcessedAttendanceRecord, UserStats, DashboardStats, OfficeLocation } from '../types';

interface TabProps {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onPress: () => void;
}

interface CardProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  style?: object;
}

// Tab component for the tabbed interface
const Tab: React.FC<TabProps> = ({ label, icon, active, onPress }) => {
  return (
    <TouchableOpacity 
      style={[styles.tab, active && styles.activeTab]} 
      onPress={onPress}
    >
      {icon}
      <Text style={[styles.tabLabel, active && styles.activeTabLabel]}>{label}</Text>
    </TouchableOpacity>
  );
};

// Card component for consistent UI
const Card: React.FC<CardProps> = ({ title, icon, children, style = {} }) => {
  return (
    <View style={[styles.card, style]}>
      <View style={styles.cardHeader}>
        {icon}
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
};

export default function AdminDashboard() {
  // State variables with proper types
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [officeLocation, setOfficeLocation] = useState<OfficeLocation>({
    latitude: '',
    longitude: '',
    radius: ''
  });
  const router = useRouter();

  // Processed data for better display
  const [processedAttendance, setProcessedAttendance] = useState<ProcessedAttendanceRecord[]>([]);
  const [userStats, setUserStats] = useState<Record<string, UserStats>>({});
  const [dashboardStats, setDashboardStats] = useState<DashboardStats>({
    totalUsers: 0,
    checkedInUsers: 0,
    todayAttendance: 0,
    avgHoursToday: 0
  });

  // Initial setup and admin access check
  useEffect(() => {
    const checkAdminAccess = async () => {
      try {
        const user = auth.currentUser;
        if (!user) {
          setTimeout(() => {
            router.replace('/(auth)/login');
          }, 0);
          return;
        }

        // Let's update the current user to make them an admin if needed
        const userRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userRef);
        
        // If the user document doesn't exist or doesn't have isAdmin field,
        // we'll create it and set them as an admin for this demo
        if (!userDoc.exists()) {
          await setDoc(userRef, {
            isAdmin: true,
            email: user.email,
            name: user.displayName || 'Admin User',
            userId: user.uid,
            createdAt: new Date().toISOString()
          });
          fetchData();
          return;
        }
        
        const userData = userDoc.data();
        
        // If isAdmin field is missing, add it
        if (userData && userData.isAdmin === undefined) {
          await setDoc(userRef, { isAdmin: true }, { merge: true });
          fetchData();
          return;
        }

        if (!userData?.isAdmin) {
          Alert.alert('Unauthorized', 'You do not have access to this page');
          setTimeout(() => {
            router.replace('/(auth)/login');
          }, 100);
          return;
        }

        fetchData();
      } catch (error) {
        console.error('Error checking admin access:', error);
        Alert.alert('Error', 'Authentication error', [{
          text: 'OK',
          onPress: () => {
            setTimeout(() => {
              router.replace('/(auth)/login');
            }, 100);
          }
        }]);
      }
    };

    checkAdminAccess();
  }, []);

  // Process attendance records to pair check-ins with check-outs and calculate durations
  useEffect(() => {
    if (attendanceRecords.length > 0 && users.length > 0) {
      // Group records by user and date
      const recordsByUserAndDate: Record<string, Record<string, AttendanceRecord[]>> = {};
      
      attendanceRecords.forEach(record => {
        const userId = record.userId;
        const date = new Date(record.timestamp).toLocaleDateString();
        
        if (!recordsByUserAndDate[userId]) {
          recordsByUserAndDate[userId] = {};
        }
        
        if (!recordsByUserAndDate[userId][date]) {
          recordsByUserAndDate[userId][date] = [];
        }
        
        recordsByUserAndDate[userId][date].push(record);
      });
      
      // Process records for each user and date
      const processed: ProcessedAttendanceRecord[] = [];
      const stats: Record<string, UserStats> = {};
      let totalHoursToday = 0;
      let usersWithHoursToday = 0;
      
      const today = new Date().toLocaleDateString();
      
      Object.keys(recordsByUserAndDate).forEach(userId => {
        const user = users.find(u => u.id === userId);
        if (!user) return;
        
        let userTotalMinutesToday = 0;
        let userTotalMinutesAllTime = 0;
        
        Object.keys(recordsByUserAndDate[userId]).forEach(date => {
          const dayRecords = recordsByUserAndDate[userId][date].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
          
          // Process check-ins and check-outs for this day
          const checkInsAndOuts: ProcessedAttendanceRecord[] = [];
          for (let i = 0; i < dayRecords.length; i++) {
            const record = dayRecords[i];
            
            if (record.type === 'check-in') {
              // Find next check-out
              const matchingCheckOut = dayRecords.find(
                r => r.type === 'check-out' && 
                new Date(r.timestamp).getTime() > new Date(record.timestamp).getTime()
              );
              
              const entry: ProcessedAttendanceRecord = {
                userId,
                userName: user.name || 'Unknown',
                userEmail: user.email || 'Unknown',
                date,
                checkIn: record,
                checkOut: matchingCheckOut || null
              };
              
              // Calculate duration if we have both check-in and check-out
              if (entry.checkIn && entry.checkOut) {
                const checkInTime = new Date(entry.checkIn.timestamp).getTime();
                const checkOutTime = new Date(entry.checkOut.timestamp).getTime();
                const durationMs = checkOutTime - checkInTime;
                const durationMinutes = Math.round(durationMs / (1000 * 60));
                
                entry.duration = durationMinutes;
                
                // Add to user's total minutes
                userTotalMinutesAllTime += durationMinutes;
                if (date === today) {
                  userTotalMinutesToday += durationMinutes;
                }
              }
              
              checkInsAndOuts.push(entry);
              
              // If we found a matching check-out, remove it from further consideration
              if (matchingCheckOut) {
                const index = dayRecords.indexOf(matchingCheckOut);
                if (index > -1) {
                  dayRecords.splice(index, 1);
                }
              }
            }
          }
          
          // Add any remaining unpaired check-outs (should be rare)
          for (let i = 0; i < dayRecords.length; i++) {
            const record = dayRecords[i];
            if (record.type === 'check-out') {
              checkInsAndOuts.push({
                userId,
                userName: user.name || 'Unknown',
                userEmail: user.email || 'Unknown',
                date,
                checkIn: null,
                checkOut: record
              });
            }
          }
          
          // Add all check-ins and outs for this day to the processed array
          processed.push(...checkInsAndOuts);
        });
        
        // Store stats for this user
        stats[userId] = {
          name: user.name,
          email: user.email,
          totalMinutesToday: userTotalMinutesToday,
          totalHoursToday: Math.floor(userTotalMinutesToday / 60) + (userTotalMinutesToday % 60) / 60,
          totalMinutesAllTime: userTotalMinutesAllTime,
          totalHoursAllTime: Math.floor(userTotalMinutesAllTime / 60) + (userTotalMinutesAllTime % 60) / 60
        };
        
        if (userTotalMinutesToday > 0) {
          totalHoursToday += userTotalMinutesToday / 60;
          usersWithHoursToday++;
        }
      });
      
      // Sort by date and time (most recent first)
      processed.sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        if (dateA !== dateB) return dateB - dateA;
        
        const timeA = a.checkIn ? new Date(a.checkIn.timestamp).getTime() : new Date(a.checkOut!.timestamp).getTime();
        const timeB = b.checkIn ? new Date(b.checkIn.timestamp).getTime() : new Date(b.checkOut!.timestamp).getTime();
        return timeB - timeA;
      });
      
      // Update the dashboard stats
      const todayRecords = processed.filter(record => record.date === today);
      setDashboardStats({
        totalUsers: users.length,
        checkedInUsers: users.filter(user => user.checkedIn).length,
        todayAttendance: todayRecords.length > 0 ? new Set(todayRecords.map(r => r.userId)).size : 0,
        avgHoursToday: usersWithHoursToday > 0 ? Number((totalHoursToday / usersWithHoursToday).toFixed(1)) : 0
      });
      
      setProcessedAttendance(processed);
      setUserStats(stats);
    }
  }, [attendanceRecords, users]);

  // Fetch all required data
  const fetchData = async () => {
    try {
      setLoading(true);
      await Promise.all([
        fetchUsers(),
        fetchAttendanceRecords(),
        fetchOfficeLocation()
      ]);
    } catch (error) {
      console.error('Error fetching data:', error);
      Alert.alert('Error', 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  // Fetch users data
  const fetchUsers = async () => {
    try {
      const usersRef = collection(db, 'users');
      const querySnapshot = await getDocs(usersRef);
      const usersList: User[] = [];
      querySnapshot.forEach((doc) => {
        usersList.push({ id: doc.id, ...doc.data() } as User);
      });
      setUsers(usersList);
    } catch (error) {
      console.error('Error fetching users:', error);
      Alert.alert('Error', 'Failed to fetch users');
    }
  };

  // Fetch office location settings
  const fetchOfficeLocation = async () => {
    try {
      const docRef = doc(db, 'settings', 'office_location');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        setOfficeLocation({
          latitude: data.latitude.toString(),
          longitude: data.longitude.toString(),
          radius: data.radius.toString()
        });
      }
    } catch (error) {
      console.error('Error fetching office location:', error);
    }
  };

  // Save office location settings
  const saveOfficeLocation = async () => {
    if (!officeLocation.latitude || !officeLocation.longitude || !officeLocation.radius) {
      Alert.alert('Error', 'Please fill all fields');
      return;
    }

    try {
      await setDoc(doc(db, 'settings', 'office_location'), {
        latitude: parseFloat(officeLocation.latitude),
        longitude: parseFloat(officeLocation.longitude),
        radius: parseFloat(officeLocation.radius)
      });
      Alert.alert('Success', 'Office location updated successfully');
    } catch (error) {
      Alert.alert('Error', 'Failed to update office location');
    }
  };

  // Update user role (admin/regular user)
  const updateUserRole = async (userId: string, isAdmin: boolean) => {
    try {
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, { isAdmin });
      
      // Update local state
      setUsers(users.map(user => 
        user.id === userId ? { ...user, isAdmin } : user
      ));
      
      Alert.alert('Success', `User role updated to ${isAdmin ? 'Admin' : 'Regular User'}`);
    } catch (error) {
      console.error('Error updating user role:', error);
      Alert.alert('Error', 'Failed to update user role');
    }
  };

  // Fetch attendance records
  const fetchAttendanceRecords = async () => {
    try {
      const q = query(collection(db, 'attendance'), orderBy('timestamp', 'desc'));
      const querySnapshot = await getDocs(q);
      const records: AttendanceRecord[] = [];
      querySnapshot.forEach((doc) => {
        records.push({ id: doc.id, ...doc.data() } as AttendanceRecord);
      });
      setAttendanceRecords(records);
    } catch (error) {
      console.error('Error fetching attendance records:', error);
    }
  };

  // Handle refresh
  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  // Handle sign out
  const handleSignOut = async () => {
    try {
      await signOut(auth);
      router.replace('/(auth)/login');
    } catch (error) {
      Alert.alert('Error', 'Failed to sign out');
    }
  };

  // Format minutes to hours and minutes display
  const formatDuration = (minutes: number) => {
    if (!minutes && minutes !== 0) return 'N/A';
    
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    
    if (hours === 0) {
      return `${mins} min`;
    } else if (mins === 0) {
      return `${hours} hr`;
    } else {
      return `${hours} hr ${mins} min`;
    }
  };

  // Loading screen
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  // Render different content based on active tab
  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <ScrollView 
            style={styles.tabContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          >
            {/* Dashboard stats */}
            <View style={styles.statsGrid}>
              <View style={styles.statsCard}>
                <Users size={24} color="#007AFF" />
                <Text style={styles.statsValue}>{dashboardStats.totalUsers}</Text>
                <Text style={styles.statsLabel}>Total Users</Text>
              </View>
              
              <View style={styles.statsCard}>
                <MapPin size={24} color="#34C759" />
                <Text style={styles.statsValue}>{dashboardStats.checkedInUsers}</Text>
                <Text style={styles.statsLabel}>Currently Checked In</Text>
              </View>
              
              <View style={styles.statsCard}>
                <Calendar size={24} color="#FF9500" />
                <Text style={styles.statsValue}>{dashboardStats.todayAttendance}</Text>
                <Text style={styles.statsLabel}>Today's Attendance</Text>
              </View>
              
              <View style={styles.statsCard}>
                <Clock size={24} color="#FF2D55" />
                <Text style={styles.statsValue}>{dashboardStats.avgHoursToday}</Text>
                <Text style={styles.statsLabel}>Avg Hours Today</Text>
              </View>
            </View>

            {/* Recent attendance */}
            <Card
              title="Today's Attendance"
              icon={<Calendar size={20} color="#007AFF" />}
              style={{ marginTop: 15 }}
            >
              {processedAttendance.filter(record => 
                record.date === new Date().toLocaleDateString()
              ).length > 0 ? (
                <View>
                  <View style={styles.attendanceTableHeader}>
                    <Text style={[styles.tableHeaderCell, { flex: 2 }]}>User</Text>
                    <Text style={[styles.tableHeaderCell, { flex: 1.5 }]}>Check In</Text>
                    <Text style={[styles.tableHeaderCell, { flex: 1.5 }]}>Check Out</Text>
                    <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Duration</Text>
                  </View>
                  
                  {processedAttendance
                    .filter(record => record.date === new Date().toLocaleDateString())
                    .map((record, index) => (
                      <View key={index} style={styles.attendanceTableRow}>
                        <View style={[styles.tableCell, { flex: 2 }]}>
                          <Text style={styles.tableCellName}>{record.userName}</Text>
                        </View>
                        
                        <View style={[styles.tableCell, { flex: 1.5 }]}>
                          <Text style={[styles.tableCellTime, { color: '#34C759' }]}>
                            {record.checkIn 
                              ? new Date(record.checkIn.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
                              : '—'}
                          </Text>
                        </View>
                        
                        <View style={[styles.tableCell, { flex: 1.5 }]}>
                          <Text style={[styles.tableCellTime, { color: record.checkOut ? '#FF3B30' : '#FF9500' }]}>
                            {record.checkOut 
                              ? new Date(record.checkOut.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
                              : 'Not checked out'}
                          </Text>
                        </View>
                        
                        <View style={[styles.tableCell, { flex: 1 }]}>
                          <Text style={styles.tableCellDuration}>
                            {record.duration ? formatDuration(record.duration) : '—'}
                          </Text>
                        </View>
                      </View>
                    ))
                  }
                </View>
              ) : (
                <Text style={styles.noRecords}>No attendance records for today</Text>
              )}
            </Card>

            {/* User productivity */}
            <Card
              title="User Productivity (Today)"
              icon={<BarChart3 size={20} color="#007AFF" />}
              style={{ marginTop: 15, marginBottom: 20 }}
            >
              {Object.values(userStats).some(user => user.totalMinutesToday > 0) ? (
                <View>
                  <View style={styles.attendanceTableHeader}>
                    <Text style={[styles.tableHeaderCell, { flex: 2 }]}>User</Text>
                    <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Hours</Text>
                  </View>
                  
                  {Object.entries(userStats)
                    .filter(([_, user]) => user.totalMinutesToday > 0)
                    .sort(([_, a], [__, b]) => b.totalMinutesToday - a.totalMinutesToday)
                    .map(([userId, user], index) => (
                      <View key={userId} style={styles.attendanceTableRow}>
                        <View style={[styles.tableCell, { flex: 2 }]}>
                          <Text style={styles.tableCellName}>{user.name}</Text>
                        </View>
                        
                        <View style={[styles.tableCell, { flex: 1 }]}>
                          <Text style={styles.tableCellDuration}>
                            {formatDuration(user.totalMinutesToday)}
                          </Text>
                        </View>
                      </View>
                    ))
                  }
                </View>
              ) : (
                <Text style={styles.noRecords}>No productivity data for today</Text>
              )}
            </Card>
          </ScrollView>
        );

      case 'users':
        if (selectedUser) {
          // User detail screen
          const user = users.find(u => u.id === selectedUser);
          if (!user) return <Text style={styles.noRecords}>User not found</Text>;
          
          const userAttendance = processedAttendance.filter(record => record.userId === selectedUser);
          const stats = userStats[selectedUser] || { totalHoursToday: 0, totalHoursAllTime: 0 };
          
          return (
            <ScrollView 
              style={styles.tabContent}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            >
              {/* Back button */}
              <TouchableOpacity 
                style={styles.backButton}
                onPress={() => setSelectedUser(null)}
              >
                <Text style={styles.backButtonText}>← Back to Users List</Text>
              </TouchableOpacity>
              
              {/* User profile */}
              <Card title="User Profile" icon={<UserIcon size={20} color="#007AFF" />}>
                <View style={styles.userProfileContainer}>
                  <View style={styles.userAvatar}>
                    <Text style={styles.userInitials}>
                      {user.name ? user.name.charAt(0).toUpperCase() : 'U'}
                    </Text>
                  </View>
                  
                  <Text style={styles.userDetailName}>{user.name || 'Unknown'}</Text>
                  <Text style={styles.userDetailEmail}>{user.email || 'No email'}</Text>
                  
                  <View style={styles.userDetailStats}>
                    <View style={styles.userDetailStat}>
                      <Clock size={16} color="#007AFF" />
                      <Text style={styles.userDetailStatLabel}>Today:</Text>
                      <Text style={styles.userDetailStatValue}>
                        {stats.totalHoursToday.toFixed(1)} hrs
                      </Text>
                    </View>
                    
                    <View style={styles.userDetailStat}>
                      <Calendar size={16} color="#007AFF" />
                      <Text style={styles.userDetailStatLabel}>All Time:</Text>
                      <Text style={styles.userDetailStatValue}>
                        {stats.totalHoursAllTime.toFixed(1)} hrs
                      </Text>
                    </View>
                    
                    <View style={styles.userDetailStat}>
                      <Shield size={16} color="#007AFF" />
                      <Text style={styles.userDetailStatLabel}>Role:</Text>
                      <Text style={styles.userDetailStatValue}>
                        {user.isAdmin ? 'Admin' : 'User'}
                      </Text>
                    </View>
                  </View>
                </View>
              </Card>
              
              {/* Device info */}
              <Card 
                title="Device Information" 
                icon={<Smartphone size={20} color="#007AFF" />}
                style={{ marginTop: 15 }}
              >
                {user.deviceInfo ? (
                  <View style={styles.deviceInfoContainer}>
                    <View style={styles.deviceInfoRow}>
                      <Text style={styles.deviceInfoLabel}>Device:</Text>
                      <Text style={styles.deviceInfoValue}>
                        {user.deviceInfo.brand} {user.deviceInfo.modelName}
                      </Text>
                    </View>
                    
                    <View style={styles.deviceInfoRow}>
                      <Text style={styles.deviceInfoLabel}>OS:</Text>
                      <Text style={styles.deviceInfoValue}>
                        {user.deviceInfo.osName} {user.deviceInfo.osVersion}
                      </Text>
                    </View>
                    
                    <View style={styles.deviceInfoRow}>
                      <Text style={styles.deviceInfoLabel}>IMEI/ID:</Text>
                      <Text style={styles.deviceInfoValue}>
                        {user.deviceInfo.imei || user.deviceInfo.deviceId || 'Unknown'}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <Text style={styles.noRecords}>No device information available</Text>
                )}
              </Card>
              
              {/* Attendance history */}
              <Card 
                title="Attendance History" 
                icon={<Calendar size={20} color="#007AFF" />}
                style={{ marginTop: 15, marginBottom: 20 }}
              >
                {userAttendance.length > 0 ? (
                  <View>
                    {/* Group attendance by date */}
                    {Array.from(new Set(userAttendance.map(record => record.date)))
                      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
                      .map(date => {
                        const dayRecords = userAttendance.filter(record => record.date === date);
                        const dayTotalMinutes = dayRecords.reduce((total, record) => 
                          total + (record.duration || 0), 0);
                        
                        return (
                          <View key={date} style={styles.attendanceDateGroup}>
                            <View style={styles.attendanceDateHeader}>
                              <Text style={styles.attendanceDateText}>
                                {new Date(date).toLocaleDateString(undefined, { 
                                  weekday: 'long', 
                                  year: 'numeric', 
                                  month: 'long', 
                                  day: 'numeric' 
                                })}
                              </Text>
                              <Text style={styles.attendanceDateTotal}>
                                Total: {formatDuration(dayTotalMinutes)}
                              </Text>
                            </View>
                            
                            <View style={styles.attendanceTableHeader}>
                              <Text style={[styles.tableHeaderCell, { flex: 1.5 }]}>Check In</Text>
                              <Text style={[styles.tableHeaderCell, { flex: 1.5 }]}>Check Out</Text>
                              <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Duration</Text>
                            </View>
                            
                            {dayRecords.map((record, index) => (
                              <View key={index} style={styles.attendanceTableRow}>
                                <View style={[styles.tableCell, { flex: 1.5 }]}>
                                  <Text style={[styles.tableCellTime, { color: '#34C759' }]}>
                                    {record.checkIn 
                                      ? new Date(record.checkIn.timestamp).toLocaleTimeString([], { 
                                          hour: '2-digit', 
                                          minute: '2-digit' 
                                        }) 
                                      : '—'}
                                  </Text>
                                </View>
                                
                                <View style={[styles.tableCell, { flex: 1.5 }]}>
                                  <Text style={[styles.tableCellTime, { color: record.checkOut ? '#FF3B30' : '#FF9500' }]}>
                                    {record.checkOut 
                                      ? new Date(record.checkOut.timestamp).toLocaleTimeString([], { 
                                          hour: '2-digit', 
                                          minute: '2-digit' 
                                        }) 
                                      : 'Not checked out'}
                                  </Text>
                                </View>
                                
                                <View style={[styles.tableCell, { flex: 1 }]}>
                                  <Text style={styles.tableCellDuration}>
                                    {record.duration ? formatDuration(record.duration) : '—'}
                                  </Text>
                                </View>
                              </View>
                            ))}
                          </View>
                        );
                      })
                    }
                  </View>
                ) : (
                  <Text style={styles.noRecords}>No attendance records found</Text>
                )}
              </Card>
            </ScrollView>
          );
        }
        
        // Users list
        return (
          <ScrollView 
            style={styles.tabContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          >
            <Card title="All Users" icon={<Users size={20} color="#007AFF" />}>
              {users
                .filter(user => user.id !== auth.currentUser?.uid) // Filter out current admin
                .map(user => (
                  <TouchableOpacity 
                    key={user.id} 
                    style={styles.userListItem}
                    onPress={() => setSelectedUser(user.id)}
                  >
                    <View style={styles.userListAvatarContainer}>
                      <View style={styles.userListAvatar}>
                        <Text style={styles.userListInitials}>
                          {user.name ? user.name.charAt(0).toUpperCase() : 'U'}
                        </Text>
                      </View>
                    </View>
                    
                    <View style={styles.userListInfo}>
                      <Text style={styles.userListName}>{user.name || 'Unknown'}</Text>
                      <Text style={styles.userListEmail}>{user.email || 'No email'}</Text>
                      <Text style={[
                        styles.userListStatus, 
                        { color: user.checkedIn ? '#34C759' : '#FF3B30' }
                      ]}>
                        {user.checkedIn ? 'Checked In' : 'Checked Out'}
                      </Text>
                    </View>
                    
                    <ChevronRight size={20} color="#999" />
                  </TouchableOpacity>
                ))}
            </Card>
          </ScrollView>
        );

      case 'settings':
        return (
          <ScrollView 
            style={styles.tabContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          >
            {/* User roles management */}
            <Card title="User Roles" icon={<Shield size={20} color="#007AFF" />}>
              {users
                .filter(user => user.id !== auth.currentUser?.uid) // Filter out current admin
                .map(user => (
                  <View key={user.id} style={styles.userRoleItem}>
                    <View style={styles.userRoleInfo}>
                      <Text style={styles.userRoleName}>{user.name || 'Unknown'}</Text>
                      <Text style={styles.userRoleEmail}>{user.email || 'No email'}</Text>
                    </View>
                    
                    <View style={styles.userRoleActions}>
                      <TouchableOpacity
                        style={[
                          styles.roleButton,
                          user.isAdmin ? styles.roleButtonActive : styles.roleButtonInactive
                        ]}
                        onPress={() => updateUserRole(user.id, true)}
                      >
                        <Text style={[
                          styles.roleButtonText,
                          user.isAdmin ? styles.roleButtonTextActive : styles.roleButtonTextInactive
                        ]}>
                          Admin
                        </Text>
                      </TouchableOpacity>
                      
                      <TouchableOpacity
                        style={[
                          styles.roleButton,
                          !user.isAdmin ? styles.roleButtonActive : styles.roleButtonInactive
                        ]}
                        onPress={() => updateUserRole(user.id, false)}
                      >
                        <Text style={[
                          styles.roleButtonText,
                          !user.isAdmin ? styles.roleButtonTextActive : styles.roleButtonTextInactive
                        ]}>
                          User
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
            </Card>

            {/* Admin profile */}
            <Card 
              title="Admin Profile" 
              icon={<UserIcon size={20} color="#007AFF" />}
              style={{ marginTop: 15 }}
            >
              <View style={styles.adminProfileContainer}>
                <View style={styles.adminAvatar}>
                  <Text style={styles.adminInitials}>
                    {auth.currentUser?.displayName 
                      ? auth.currentUser.displayName.charAt(0).toUpperCase() 
                      : auth.currentUser?.email
                        ? auth.currentUser.email.charAt(0).toUpperCase()
                        : 'A'
                    }
                  </Text>
                </View>
                
                <Text style={styles.adminName}>
                  {auth.currentUser?.displayName || 'Admin User'}
                </Text>
                <Text style={styles.adminEmail}>
                  {auth.currentUser?.email || 'No email'}
                </Text>
                
                <TouchableOpacity
                  style={styles.signOutButton}
                  onPress={handleSignOut}
                >
                  <LogOut size={18} color="#FF3B30" />
                  <Text style={styles.signOutButtonText}>Sign Out</Text>
                </TouchableOpacity>
              </View>
            </Card>
          </ScrollView>
        );

      case 'location':
        return (
          <ScrollView 
            style={styles.tabContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          >
            <Card title="Office Location Settings" icon={<MapPin size={20} color="#007AFF" />}>
              <View style={styles.locationSettingsContainer}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Latitude</Text>
                  <TextInput
                    style={styles.input}
                    value={officeLocation.latitude}
                    onChangeText={(text) => setOfficeLocation(prev => ({ ...prev, latitude: text }))}
                    keyboardType="numeric"
                    placeholder="Enter latitude"
                  />
                </View>
                
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Longitude</Text>
                  <TextInput
                    style={styles.input}
                    value={officeLocation.longitude}
                    onChangeText={(text) => setOfficeLocation(prev => ({ ...prev, longitude: text }))}
                    keyboardType="numeric"
                    placeholder="Enter longitude"
                  />
                </View>
                
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Radius (meters)</Text>
                  <TextInput
                    style={styles.input}
                    value={officeLocation.radius}
                    onChangeText={(text) => setOfficeLocation(prev => ({ ...prev, radius: text }))}
                    keyboardType="numeric"
                    placeholder="Enter radius in meters"
                  />
                </View>
                
                <TouchableOpacity
                  style={styles.saveLocationButton}
                  onPress={saveOfficeLocation}
                >
                  <Save size={18} color="#fff" />
                  <Text style={styles.saveLocationButtonText}>Save Location</Text>
                </TouchableOpacity>
                
                <Text style={styles.locationHelp}>
                  Set the office location and radius to define the area where employees can check in.
                </Text>
              </View>
            </Card>
          </ScrollView>
        );

      default:
        return (
          <View style={styles.tabContent}>
            <Text style={styles.noRecords}>Invalid tab selected</Text>
          </View>
        );
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Admin Dashboard</Text>
      </View>
      
      <View style={styles.content}>
        {renderContent()}
      </View>
      
      <View style={styles.tabBar}>
        <Tab 
          label="Dashboard" 
          icon={<Home size={20} color={activeTab === 'dashboard' ? '#007AFF' : '#999'} />} 
          active={activeTab === 'dashboard'} 
          onPress={() => setActiveTab('dashboard')}
        />
        <Tab 
          label="Users" 
          icon={<Users size={20} color={activeTab === 'users' ? '#007AFF' : '#999'} />} 
          active={activeTab === 'users'} 
          onPress={() => {
            setActiveTab('users');
            setSelectedUser(null); // Reset selected user when switching to users tab
          }}
        />
        <Tab 
          label="Settings" 
          icon={<Settings size={20} color={activeTab === 'settings' ? '#007AFF' : '#999'} />} 
          active={activeTab === 'settings'} 
          onPress={() => setActiveTab('settings')}
        />
        <Tab 
          label="Location" 
          icon={<MapPin size={20} color={activeTab === 'location' ? '#007AFF' : '#999'} />} 
          active={activeTab === 'location'} 
          onPress={() => setActiveTab('location')}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    padding: 15,
    backgroundColor: '#007AFF',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  content: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingVertical: 8,
    paddingHorizontal: 5,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  activeTab: {
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  tabLabel: {
    marginTop: 5,
    fontSize: 12,
    color: '#999',
  },
  activeTabLabel: {
    color: '#007AFF',
    fontWeight: '500',
  },
  tabContent: {
    flex: 1,
    padding: 15,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  cardTitle: {
    marginLeft: 10,
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  
  // Dashboard tab styles
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -5,
  },
  statsCard: {
    width: '50%',
    padding: 15,
    backgroundColor: '#fff',
    borderRadius: 10,
    margin: 5,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  statsValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 10,
    marginBottom: 5,
  },
  statsLabel: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
  },
  
  // Attendance table styles
  attendanceTableHeader: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    marginBottom: 5,
  },
  tableHeaderCell: {
    fontSize: 12,
    fontWeight: '600',
    color: '#999',
    textTransform: 'uppercase',
  },
  attendanceTableRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  tableCell: {
    justifyContent: 'center',
  },
  tableCellName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  tableCellTime: {
    fontSize: 14,
    fontWeight: '500',
  },
  tableCellDuration: {
    fontSize: 14,
    color: '#666',
  },
  noRecords: {
    textAlign: 'center',
    color: '#999',
    fontStyle: 'italic',
    padding: 15,
  },
  
  // User list styles
  userListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  userListAvatarContainer: {
    marginRight: 15,
  },
  userListAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#e1f0ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userListInitials: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#007AFF',
  },
  userListInfo: {
    flex: 1,
  },
  userListName: {
    fontSize: 15,
    fontWeight: '500',
    color: '#333',
    marginBottom: 2,
  },
  userListEmail: {
    fontSize: 13,
    color: '#666',
    marginBottom: 2,
  },
  userListStatus: {
    fontSize: 12,
    fontWeight: '500',
  },
  
  // User detail styles
  backButton: {
    marginBottom: 15,
  },
  backButtonText: {
    color: '#007AFF',
    fontSize: 15,
    fontWeight: '500',
  },
  userProfileContainer: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  userAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#e1f0ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 15,
  },
  userInitials: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#007AFF',
  },
  userDetailName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  userDetailEmail: {
    fontSize: 15,
    color: '#666',
    marginBottom: 15,
  },
  userDetailStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
    width: '100%',
  },
  userDetailStat: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f8f8',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginRight: 10,
    marginBottom: 10,
  },
  userDetailStatLabel: {
    fontSize: 13,
    color: '#666',
    marginLeft: 5,
    marginRight: 5,
  },
  userDetailStatValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  deviceInfoContainer: {
    paddingVertical: 5,
  },
  deviceInfoRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  deviceInfoLabel: {
    width: 70,
    fontSize: 14,
    color: '#666',
  },
  deviceInfoValue: {
    flex: 1,
    fontSize: 14,
    color: '#333',
  },
  attendanceDateGroup: {
    marginBottom: 20,
  },
  attendanceDateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  attendanceDateText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  attendanceDateTotal: {
    fontSize: 13,
    color: '#007AFF',
    fontWeight: '500',
  },
  
  // Settings tab styles
  userRoleItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  userRoleInfo: {
    flex: 1,
  },
  userRoleName: {
    fontSize: 15,
    fontWeight: '500',
    color: '#333',
    marginBottom: 2,
  },
  userRoleEmail: {
    fontSize: 13,
    color: '#666',
  },
  userRoleActions: {
    flexDirection: 'row',
  },
  roleButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 4,
    marginLeft: 8,
  },
  roleButtonActive: {
    backgroundColor: '#007AFF',
  },
  roleButtonInactive: {
    backgroundColor: '#f0f0f0',
  },
  roleButtonText: {
    fontSize: 13,
    fontWeight: '500',
  },
  roleButtonTextActive: {
    color: '#fff',
  },
  roleButtonTextInactive: {
    color: '#666',
  },
  adminProfileContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  adminAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#e1f0ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 15,
  },
  adminInitials: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#007AFF',
  },
  adminName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  adminEmail: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff0f0',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ffcccb',
  },
  signOutButtonText: {
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '500',
    color: '#FF3B30',
  },
  
  // Location tab styles
  locationSettingsContainer: {
    paddingVertical: 10,
  },
  inputGroup: {
    marginBottom: 15,
  },
  inputLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#f9f9f9',
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  saveLocationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 10,
  },
  saveLocationButtonText: {
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '500',
    color: '#fff',
  },
  locationHelp: {
    marginTop: 15,
    fontSize: 13,
    color: '#999',
    lineHeight: 18,
  },
});