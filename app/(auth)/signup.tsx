import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Image, Platform } from 'react-native';
import { router } from 'expo-router';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { Lock, Mail, User, Smartphone } from 'lucide-react-native';
import { auth, db } from '../config/firebase';
import * as Device from 'react-native-device-info';
import { User as UserType } from '../types/index';

export default function SignupScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);

  const getDeviceInfo = async () => {
    try {
      const deviceInfo = {
        brand: await Device.getBrand(),
        modelName: await Device.getModel(),
        osName: Platform.OS,
        osVersion: await Device.getSystemVersion(),
        deviceId: await Device.getUniqueId(),
        imei: [] as string[]
      };

      // Try to get IMEI (only works on Android)
      if (Platform.OS === 'android') {
        try {
          const imei = await Device.getImei();
          if (imei) {
            deviceInfo.imei.push(imei);
          }
        } catch (error) {
          console.log('Error getting IMEI:', error);
        }
      }

      // Add device ID as fallback
      deviceInfo.imei.push(deviceInfo.deviceId);

      return deviceInfo;
    } catch (error) {
      console.log('Error in getDeviceInfo:', error);
      return {
        brand: 'Unknown',
        modelName: 'Unknown',
        osName: Platform.OS,
        osVersion: 'Unknown',
        deviceId: `fallback-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        imei: [`fallback-${Date.now()}-${Math.random().toString(36).substring(7)}`]
      };
    }
  };

  const handleSignup = async () => {
    if (!name || !email || !password || !phone) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    try {
      setLoading(true);

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        Alert.alert('Error', 'Please enter a valid email address');
        setLoading(false);
        return;
      }

      // Validate password strength
      if (password.length < 6) {
        Alert.alert('Error', 'Password must be at least 6 characters long');
        setLoading(false);
        return;
      }

      // Create user in Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      
      // Get device information
      const deviceInfo = await getDeviceInfo();

      // Create user document with extended information
      const userDoc: UserType = {
        id: userCredential.user.uid,
        name,
        email,
        phone,
        isAdmin: false,
        createdAt: new Date().toISOString(),
        deviceInfo,
        lastLogin: new Date().toISOString(),
        status: 'active',
        biometricEnabled: true,
        biometricAttempts: [],
        checkInHistory: [],
        checkedIn: false
      };

      // Create the user document in Firestore
      await setDoc(doc(db, 'users', userCredential.user.uid), userDoc);

      // Success message before navigation
      Alert.alert('Success', 'Your account has been created successfully', [
        {
          text: 'OK',
          onPress: () => router.replace('/(tabs)')
        }
      ]);
    } catch (error: any) {
      console.error('Signup error:', error);
      
      // More user-friendly error messages
      let errorMessage = 'Failed to create account';
      
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = 'This email is already in use. Please use a different email or try logging in.';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'The email address is not valid.';
      } else if (error.code === 'auth/weak-password') {
        errorMessage = 'The password is too weak. Please use a stronger password.';
      } else if (error.code === 'auth/network-request-failed') {
        errorMessage = 'Network error. Please check your internet connection and try again.';
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      Alert.alert('Error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.formContainer}>
        <Image
          source={{ uri: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800' }}
          style={styles.headerImage}
        />
        
        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>Sign up to get started</Text>

        <View style={styles.inputContainer}>
          <User size={20} color="#666" />
          <TextInput
            style={styles.input}
            placeholder="Full Name"
            value={name}
            onChangeText={setName}
          />
        </View>
        
        <View style={styles.inputContainer}>
          <Mail size={20} color="#666" />
          <TextInput
            style={styles.input}
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
        </View>

        <View style={styles.inputContainer}>
          <Smartphone size={20} color="#666" />
          <TextInput
            style={styles.input}
            placeholder="Phone Number"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
        </View>

        <View style={styles.inputContainer}>
          <Lock size={20} color="#666" />
          <TextInput
            style={styles.input}
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
        </View>

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSignup}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? 'Creating Account...' : 'Sign Up'}
          </Text>
        </TouchableOpacity>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.link}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    padding: 20,
  },
  formContainer: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  headerImage: {
    width: '100%',
    height: 150,
    borderRadius: 10,
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
    color: '#333',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 30,
    textAlign: 'center',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    marginBottom: 15,
    padding: 12,
    borderWidth: 1,
    borderColor: '#eee',
  },
  input: {
    flex: 1,
    marginLeft: 10,
    fontSize: 16,
    color: '#333',
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
  },
  footerText: {
    color: '#666',
  },
  link: {
    color: '#007AFF',
    fontWeight: '600',
  },
});