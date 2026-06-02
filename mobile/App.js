import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import { supabase } from './src/lib/supabase';

import HomeScreen from './src/screens/HomeScreen';
import AuthScreen from './src/screens/AuthScreen';
import CameraScreen from './src/screens/CameraScreen';
import ResultScreen from './src/screens/ResultScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import CemeteryMapScreen from './src/screens/CemeteryMapScreen';
import GlobalMapScreen from './src/screens/GlobalMapScreen';
const Stack = createNativeStackNavigator();

export default function App() {
  useEffect(() => {
    // Cold-start only: app launched from scratch via the callback URL
    Linking.getInitialURL().then(url => {
      if (url?.includes('login-callback') && url.includes('code=')) {
        supabase.auth.exchangeCodeForSession(url);
      }
    });
  }, []);

  return (
    <SafeAreaProvider>
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Auth" component={AuthScreen} />
        <Stack.Screen name="Camera" component={CameraScreen} />
        <Stack.Screen name="Result" component={ResultScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="CemeteryMap" component={CemeteryMapScreen} />
        <Stack.Screen name="GlobalMap" component={GlobalMapScreen} />
      </Stack.Navigator>
    </NavigationContainer>
    </SafeAreaProvider>
  );
}
