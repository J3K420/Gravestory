import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, AppState } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import * as Updates from 'expo-updates';
import { useFonts } from 'expo-font';
import {
  Fraunces_400Regular,
  Fraunces_400Regular_Italic,
  Fraunces_500Medium,
  Fraunces_700Bold,
} from '@expo-google-fonts/fraunces';
import {
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
} from '@expo-google-fonts/hanken-grotesk';
import { supabase } from './src/lib/supabase';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import { REVENUECAT_API_KEY } from './src/lib/config';
import {
  configureNotifications,
  addStoryReadyTapListener,
} from './src/lib/notify';

import HomeScreen from './src/screens/HomeScreen';
import AuthScreen from './src/screens/AuthScreen';
import CameraScreen from './src/screens/CameraScreen';
import ResultScreen from './src/screens/ResultScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import CemeteryMapScreen from './src/screens/CemeteryMapScreen';
import GlobalMapScreen from './src/screens/GlobalMapScreen';
import RememberedStoriesScreen from './src/screens/RememberedStoriesScreen';
import PaywallScreen from './src/screens/PaywallScreen';

const Stack = createNativeStackNavigator();

// Ref so the AppState/OTA handler can read the active route on resume.
const navigationRef = createNavigationContainerRef();

// Screens where an OTA reload-on-resume would destroy in-progress work (the
// reload restarts the JS bundle at Home, dropping a scan/unsaved result/active
// purchase). On these we DEFER the reload; the next foreground from an idle
// screen (Home, lists, maps, settings) applies it. Opening the system camera
// backgrounds the app, so without this guard returning to confirm a photo
// reloads mid-scan straight to Home.
const NO_RELOAD_SCREENS = new Set(['Camera', 'Result', 'Paywall']);

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <View style={ebStyles.container}>
          <Text style={ebStyles.title}>Something went wrong</Text>
          <Text style={ebStyles.message}>{this.state.error?.message || 'An unexpected error occurred.'}</Text>
          <TouchableOpacity style={ebStyles.btn} onPress={() => this.setState({ hasError: false, error: null })}>
            <Text style={ebStyles.btnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const ebStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#14100b', alignItems: 'center', justifyContent: 'center', padding: 32 },
  title: { color: '#efe4d2', fontSize: 20, fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  message: { color: '#b7a892', fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 28 },
  btn: { backgroundColor: '#f2b65c', paddingHorizontal: 28, paddingVertical: 12, borderRadius: 13 },
  btnText: { color: '#2a1808', fontSize: 15, fontWeight: '600' },
});

export default function App() {
  const [fontsLoaded] = useFonts({
    Fraunces_400Regular,
    Fraunces_400Regular_Italic,
    Fraunces_500Medium,
    Fraunces_700Bold,
    HankenGrotesk_400Regular,
    HankenGrotesk_500Medium,
    HankenGrotesk_600SemiBold,
  });


  useEffect(() => {
    // Guard: a release build with no real key must NOT initialize RevenueCat —
    // configuring with an empty or test key crashes the SDK on release. When the
    // key is missing, skip RC entirely; the paywall shows its "not available"
    // state instead of taking down the whole app.
    const rcEnabled = !!REVENUECAT_API_KEY;
    if (rcEnabled) {
      if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.DEBUG);
      Purchases.configure({ apiKey: REVENUECAT_API_KEY });
    } else {
      console.warn('RevenueCat API key missing — purchases disabled for this session.');
    }

    // Tie RevenueCat's app_user_id to the Supabase user UUID so the
    // purchase webhook credits the correct account. Without this, purchases
    // fire with RevenueCat's anonymous ID and scan_credits is never updated.
    async function syncRevenueCatIdentity(userId) {
      if (!rcEnabled) return;
      try {
        if (userId) {
          await Purchases.logIn(userId);
        } else {
          await Purchases.logOut();
        }
      } catch (e) {
        console.warn('RevenueCat identity sync failed:', e.message);
      }
    }

    // Log in immediately if a session already exists (returning user).
    supabase.auth.getSession().then(({ data: { session } }) => {
      syncRevenueCatIdentity(session?.user?.id ?? null);
    });

    // Keep RevenueCat identity in sync with auth state changes.
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      syncRevenueCatIdentity(session?.user?.id ?? null);
    });

    Linking.getInitialURL().then(url => {
      if (url?.includes('login-callback') && url.includes('code=')) {
        const params = new URLSearchParams(url.split('?')[1] ?? '');
        const code = params.get('code');
        if (code) supabase.auth.exchangeCodeForSession(code);
      }
    });

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  // Local "story ready" notifications. configureNotifications sets the foreground
  // handler + Android channel. addStoryReadyTapListener is the single handler for
  // notification taps — it also receives the tap that COLD-LAUNCHED the app (per
  // the expo-notifications response-listener contract), so no separate sticky
  // getLastNotificationResponseAsync probe is needed (that value persists across
  // launches and would mis-route a later plain icon launch to Home). On tap we
  // route to the finished story's Result if it survived in memory and matches the
  // tapped notification, else Home (the unsaved in-memory story is gone after a
  // cold kill — Home is the honest landing).
  useEffect(() => {
    configureNotifications();

    function routeToStoryReady(story, { retries = 20 } = {}) {
      // navigationRef may not be ready on a cold start; retry briefly.
      if (!navigationRef.isReady()) {
        if (retries > 0) setTimeout(() => routeToStoryReady(story, { retries: retries - 1 }), 100);
        return;
      }
      try {
        if (story) navigationRef.navigate('Result', { story });
        else navigationRef.navigate('Home');
      } catch (e) {
        console.warn('notification routing failed:', e?.message);
      }
    }

    const unsubscribe = addStoryReadyTapListener((story) => routeToStoryReady(story));

    return () => unsubscribe();
  }, []);

  // Background/foreground lifecycle. Two things break on an app that sits
  // backgrounded for a long time (hours/days) and is then resumed WITHOUT a
  // cold start, both fixed here:
  //
  //  1. Supabase token refresh. autoRefreshToken runs on a JS setInterval the
  //     OS suspends while backgrounded, so the ~1hr access token can be expired
  //     on return. The documented RN pattern is to stop the timer in the
  //     background and start it (which also refreshes immediately) on resume.
  //  2. OTA updates. expo-updates only checks at cold start, so a long-resumed
  //     app keeps running stale JS. We check on every foreground and reload if
  //     a newer bundle is available. Guarded by Updates.isEnabled so it no-ops
  //     in dev/Expo Go (where the check would otherwise reject).
  useEffect(() => {
    async function applyPendingUpdate() {
      if (!Updates.isEnabled) return;
      try {
        const result = await Updates.checkForUpdateAsync();
        if (result.isAvailable) {
          // Fetch is safe to do anywhere (download only). But only RELOAD when
          // the user isn't mid-task — reloadAsync restarts the bundle at Home,
          // which would destroy an in-progress scan / unsaved result / active
          // purchase. On a mid-task screen we just fetch and let the next
          // foreground from an idle screen apply it.
          await Updates.fetchUpdateAsync();
          const current = navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : null;
          if (!NO_RELOAD_SCREENS.has(current)) {
            await Updates.reloadAsync();
          } else {
            console.log('OTA ready — deferring reload (mid-task screen:', current, ')');
          }
        }
      } catch (e) {
        // Offline, mid-flight, or transient — next foreground retries.
        console.warn('OTA update check on resume failed:', e.message);
      }
    }

    function handleAppStateChange(state) {
      if (state === 'active') {
        supabase.auth.startAutoRefresh();
        applyPendingUpdate();
      } else {
        supabase.auth.stopAutoRefresh();
      }
    }

    // Prime for the launch (already-foreground) state, then subscribe.
    if (AppState.currentState === 'active') supabase.auth.startAutoRefresh();
    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, []);

  if (!fontsLoaded) return null;

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <NavigationContainer ref={navigationRef}>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="Auth" component={AuthScreen} />
            <Stack.Screen name="Camera" component={CameraScreen} />
            <Stack.Screen name="Result" component={ResultScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="CemeteryMap" component={CemeteryMapScreen} />
            <Stack.Screen name="GlobalMap" component={GlobalMapScreen} />
            <Stack.Screen name="RememberedStories" component={RememberedStoriesScreen} />
            <Stack.Screen name="Paywall" component={PaywallScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
