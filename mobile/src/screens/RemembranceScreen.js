import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Linking, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker } from 'react-native-maps';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import { verifyIsGravestone } from '../lib/api-gemini';
import { reverseGeocode, searchCemeteries } from '../lib/api-nominatim';
import {
  MAX_REMEMBRANCE_PHOTOS, REMEMBRANCE_MAX_LENGTH, publishRemembrance,
} from '../lib/api-remembrances';
import { useRefresh } from '../lib/use-refresh';
import { colors, fonts, radius } from '../lib/theme';
import { Pin } from '../components/Icons';

const STEPS = ['Community rules', 'Photos', 'Remembrance', 'Location', 'Preview'];
const TERMS_URL = 'https://gravestory.pages.dev/terms/';
const LOCATION_TIMEOUT_MS = 20000;
const DEFAULT_PIN = {
  latitude: 39.5,
  longitude: -98.35,
  latitudeDelta: 35,
  longitudeDelta: 35,
};

function getCurrentPosition(signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let subscription = null;
    let timeout = null;
    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      subscription?.remove();
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onAbort = () => finish(reject, new Error('Location request cancelled'));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    timeout = setTimeout(() => finish(reject, new Error('Location request timed out')), LOCATION_TIMEOUT_MS);
    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced },
      position => finish(resolve, position),
      message => finish(reject, new Error(String(message || 'Location unavailable')))
    ).then(result => {
      subscription = result;
      if (settled) subscription.remove();
    }).catch(error => finish(reject, error));
  });
}

export default function RemembranceScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [step, setStep] = useState(0);
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [termsAcceptedAt, setTermsAcceptedAt] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [verification, setVerification] = useState(null);
  const [name, setName] = useState('');
  const [dates, setDates] = useState('');
  const [remembrance, setRemembrance] = useState('');
  const [gps, setGps] = useState(null);
  const [locationLabel, setLocationLabel] = useState('');
  const [locationMode, setLocationMode] = useState('skip');
  const [cemeteryQuery, setCemeteryQuery] = useState('');
  const [cemeteryResults, setCemeteryResults] = useState([]);
  const [visibility, setVisibility] = useState('private');
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const clientTimestampRef = useRef(null);
  const submitInFlightRef = useRef(false);
  const cemeterySearchRequestRef = useRef(0);
  const cemeteryQueryRef = useRef('');
  const locationOperationRef = useRef(null);
  const locationOperationIdRef = useRef(0);
  const screenActiveRef = useRef(false);

  function beginLocationOperation(type, label) {
    if (busy || submitInFlightRef.current || locationOperationRef.current) return null;
    const operation = { id: locationOperationIdRef.current + 1, type, controller: new AbortController() };
    locationOperationIdRef.current = operation.id;
    locationOperationRef.current = operation;
    setBusy(true);
    setBusyLabel(label);
    return operation;
  }

  function isLocationOperationCurrent(operation) {
    return screenActiveRef.current && locationOperationRef.current?.id === operation.id;
  }

  function finishLocationOperation(operation) {
    if (!isLocationOperationCurrent(operation)) return;
    locationOperationRef.current = null;
    setBusy(false);
    setBusyLabel('');
  }

  function cancelLocationOperation(type = null) {
    const operation = locationOperationRef.current;
    if (!operation || (type && operation.type !== type)) return;
    operation.controller.abort();
    locationOperationRef.current = null;
    cemeterySearchRequestRef.current += 1;
    if (screenActiveRef.current) {
      setBusy(false);
      setBusyLabel('');
    }
  }

  function handleCemeteryQueryChange(value) {
    cemeteryQueryRef.current = value;
    cemeterySearchRequestRef.current += 1;
    setCemeteryQuery(value);
    setCemeteryResults([]);
    cancelLocationOperation('cemetery-search');
  }

  useFocusEffect(
    useCallback(() => {
      let active = true;
      screenActiveRef.current = true;
      if (!submitInFlightRef.current) {
        setBusy(false);
        setBusyLabel('');
      }
      setCemeteryResults([]);
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!active) return;
        setUser(session?.user || null);
        setAuthChecked(true);
      });
      return () => {
        active = false;
        screenActiveRef.current = false;
        cemeterySearchRequestRef.current += 1;
        locationOperationRef.current?.controller.abort();
        locationOperationRef.current = null;
      };
    }, [])
  );

  const { refreshControl } = useRefresh(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setUser(session?.user || null);
  });

  async function preparePhoto(uri) {
    return ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1024 } }],
      { compress: 0.78, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );
  }

  async function choosePhoto(source, primary) {
    if (busy || photos.length >= MAX_REMEMBRANCE_PHOTOS) return;
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Camera permission needed', 'Allow camera access to photograph the gravestone.');
          return;
        }
      }
      const options = { mediaTypes: ['images'], quality: 0.85, base64: false };
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return;

      setBusy(true);
      setBusyLabel(primary ? 'Checking the gravestone…' : 'Preparing photo…');
      const prepared = await preparePhoto(result.assets[0].uri);
      if (primary) {
        let decision;
        try {
          decision = await verifyIsGravestone(prepared.base64);
        } catch (e) {
          if (e.__verificationRejection) {
            Alert.alert('Choose a gravestone photo', e.reason || 'That image does not appear to show a gravestone.');
            return;
          }
          decision = { status: 'unavailable', reason: 'Image verification was unavailable.' };
        }
        setVerification(decision);
      }
      setPhotos(previous => [...previous, { uri: prepared.uri, base64: prepared.base64 }]);
    } catch (e) {
      console.warn('Remembrance photo preparation failed:', e.message);
      Alert.alert('Photo unavailable', 'That photo could not be prepared. Please try another one.');
    } finally {
      setBusy(false);
      setBusyLabel('');
    }
  }

  async function useCurrentLocation() {
    const operation = beginLocationOperation('current-location', 'Finding your location…');
    if (!operation) return;
    setCemeteryResults([]);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!isLocationOperationCurrent(operation)) return;
      if (!permission.granted) {
        Alert.alert('Location not shared', 'You can search for a cemetery, drop a pin, or skip location.');
        return;
      }
      const result = await getCurrentPosition(operation.controller.signal);
      if (!isLocationOperationCurrent(operation)) return;
      const point = { lat: result.coords.latitude, lng: result.coords.longitude };
      const label = await reverseGeocode(point.lat, point.lng, { signal: operation.controller.signal });
      if (!isLocationOperationCurrent(operation)) return;
      setGps(point);
      setLocationMode('current');
      setLocationLabel(label || 'Current location');
    } catch (e) {
      if (!isLocationOperationCurrent(operation)) return;
      console.warn('Remembrance location failed:', e.message);
      Alert.alert('Location unavailable', 'Try cemetery search, drop a pin, or continue without location.');
    } finally {
      finishLocationOperation(operation);
    }
  }

  async function runCemeterySearch() {
    if (busy || locationOperationRef.current) return;
    const query = cemeteryQueryRef.current.trim();
    if (query.length < 3) {
      cemeterySearchRequestRef.current += 1;
      setCemeteryResults([]);
      Alert.alert('Enter more detail', 'Enter at least three characters for a cemetery or city search.');
      return;
    }
    const operation = beginLocationOperation('cemetery-search', 'Searching cemeteries…');
    if (!operation) return;
    const requestId = cemeterySearchRequestRef.current + 1;
    cemeterySearchRequestRef.current = requestId;
    setCemeteryResults([]);
    try {
      const results = await searchCemeteries(query, {
        throwOnFailure: true,
        signal: operation.controller.signal,
      });
      if (!isLocationOperationCurrent(operation)
        || requestId !== cemeterySearchRequestRef.current
        || query !== cemeteryQueryRef.current.trim()) return;
      setCemeteryResults(results);
      if (results.length === 0) Alert.alert('No cemeteries found', 'Try the cemetery name, or add a city and state.');
    } catch (error) {
      if (!isLocationOperationCurrent(operation)
        || requestId !== cemeterySearchRequestRef.current
        || query !== cemeteryQueryRef.current.trim()) return;
      console.warn('Remembrance cemetery search failed:', error?.message);
      Alert.alert('Cemetery search unavailable', 'Please check your connection and try again, or drop a pin instead.');
    } finally {
      finishLocationOperation(operation);
    }
  }

  function selectCemetery(result) {
    cancelLocationOperation();
    setGps({ lat: result.lat, lng: result.lng });
    setLocationLabel(result.name);
    setLocationMode('cemetery');
    setCemeteryResults([]);
  }

  function choosePinLocation() {
    cancelLocationOperation();
    setGps(null);
    setLocationLabel('');
    setLocationMode('pin');
    setCemeteryResults([]);
  }

  function placePin(event) {
    cancelLocationOperation();
    const coordinate = event.nativeEvent.coordinate;
    setGps({ lat: coordinate.latitude, lng: coordinate.longitude });
    setLocationLabel('Dropped pin');
    setLocationMode('pin');
  }

  function skipLocation() {
    cancelLocationOperation();
    setGps(null);
    setLocationLabel('');
    setLocationMode('skip');
    setCemeteryResults([]);
  }

  function continueFromRules() {
    if (!rulesAccepted) {
      Alert.alert('Accept the community rules', 'Please accept the Terms and community rules before uploading.');
      return;
    }
    if (!termsAcceptedAt) setTermsAcceptedAt(new Date().toISOString());
    setStep(1);
  }

  function next() {
    if (step === 0) return continueFromRules();
    if (step === 1 && photos.length === 0) {
      Alert.alert('Primary photo required', 'Add a gravestone photo before continuing.');
      return;
    }
    if (step === 2 && (!name.trim() || !remembrance.trim())) {
      Alert.alert('Tell us who this remembers', 'Enter a name and remembrance before continuing.');
      return;
    }
    setStep(value => Math.min(value + 1, STEPS.length - 1));
  }

  async function submit() {
    if (busy || submitInFlightRef.current || locationOperationRef.current) return;
    submitInFlightRef.current = true;
    setBusy(true);
    setBusyLabel('Reviewing and saving…');
    try {
      const timestamp = clientTimestampRef.current || (clientTimestampRef.current = Date.now());
      const result = await publishRemembrance({
        user,
        name,
        dates,
        remembrance,
        photos,
        location: locationLabel,
        gps,
        lowConfidence: locationMode === 'cemetery',
        requestedVisibility: visibility,
        verification,
        termsAcceptedAt,
        clientTimestamp: timestamp,
      });
      if (!result.ok) {
        Alert.alert(result.rejected ? 'Submission needs changes' : 'Could not save', result.error);
        return;
      }
      if (result.rejected) {
        Alert.alert(
          'Not published',
          result.story.moderation_reason || 'This remembrance needs changes before it can be shared publicly.',
          [{ text: 'View private story', onPress: () => navigation.replace('Result', { story: result.story }) }]
        );
        return;
      }
      if (result.partialPhotos) {
        Alert.alert('Saved with fewer photos', result.photoUploadWarning || 'Some supporting photos could not be uploaded.', [{ text: 'View story', onPress: () => navigation.replace('Result', { story: result.story }) }]);
      } else if (result.pendingReview) {
        Alert.alert(
          'Sent for review',
          result.moderationUnavailable
            ? 'Your remembrance is saved privately. Automated review was unavailable, so it will require review before appearing publicly.'
            : 'Your remembrance is saved privately while we review it. It will appear publicly only after approval.',
          [{ text: 'View story', onPress: () => navigation.replace('Result', { story: result.story }) }]
        );
      } else {
        navigation.replace('Result', { story: result.story });
      }
    } catch (e) {
      console.warn('Remembrance submission failed:', e.message);
      Alert.alert('Could not submit', 'Please check your connection and try again.');
    } finally {
      submitInFlightRef.current = false;
      setBusy(false);
      setBusyLabel('');
    }
  }

  if (!authChecked) {
    return <SafeAreaView style={styles.center}><ActivityIndicator color={colors.flame} /></SafeAreaView>;
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
          <Text style={styles.headerTitle}>Share a Remembrance</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.signInCard}>
          <Text style={styles.signInTitle}>Sign in to contribute</Text>
          <Text style={styles.bodyText}>
            A free account lets you manage, make private, or remove anything you share.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.navigate('Auth')}>
            <Text style={styles.primaryBtnText}>Sign in or create an account</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Share a Remembrance</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.progressRow}>
        {STEPS.map((label, index) => (
          <View key={label} style={styles.progressItem}>
            <View style={[styles.progressDot, index <= step && styles.progressDotOn]} />
            <Text style={[styles.progressText, index === step && styles.progressTextOn]} numberOfLines={1}>
              {label}
            </Text>
          </View>
        ))}
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
          {step === 0 && (
            <View>
              <Text style={styles.stepTitle}>Keep this community respectful</Text>
              <Text style={styles.bodyText}>
                Share only photos and stories you have the right to use. Do not post private information about living people,
                harassment, hate, sexual content, graphic violence, spam, or illegal material. Public contributions can be
                reported, reviewed, made private, or removed.
              </Text>
              <TouchableOpacity style={styles.linkBtn} onPress={() => Linking.openURL(TERMS_URL)}>
                <Text style={styles.linkText}>Read the full Terms and community rules ›</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.checkRow}
                onPress={() => setRulesAccepted(value => !value)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: rulesAccepted }}
              >
                <View style={[styles.checkbox, rulesAccepted && styles.checkboxOn]}>
                  {rulesAccepted && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text style={styles.checkLabel}>I accept the Terms and community rules.</Text>
              </TouchableOpacity>
            </View>
          )}

          {step === 1 && (
            <View>
              <Text style={styles.stepTitle}>Add the gravestone photo</Text>
              <Text style={styles.bodyText}>
                The first photo must show the gravestone. After it passes, you may add up to three supporting photos.
              </Text>
              {photos.length === 0 ? (
                <View style={styles.photoActions}>
                  <TouchableOpacity style={styles.primaryBtn} onPress={() => choosePhoto('camera', true)}>
                    <Text style={styles.primaryBtnText}>Take primary photo</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.secondaryBtn} onPress={() => choosePhoto('library', true)}>
                    <Text style={styles.secondaryBtnText}>Choose from library</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <ScrollView horizontal contentContainerStyle={styles.photoStrip} showsHorizontalScrollIndicator={false}>
                    {photos.map((photo, index) => (
                      <View key={`${photo.uri}-${index}`} style={styles.photoWrap}>
                        <Image source={{ uri: photo.uri }} style={styles.photo} />
                        <Text style={styles.photoLabel}>{index === 0 ? 'Primary' : `Supporting ${index}`}</Text>
                        {index > 0 && (
                          <TouchableOpacity style={styles.removePhoto} onPress={() => setPhotos(list => list.filter((_, i) => i !== index))}>
                            <Text style={styles.removePhotoText}>×</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}
                  </ScrollView>
                  {photos.length < MAX_REMEMBRANCE_PHOTOS && (
                    <View style={styles.inlineActions}>
                      <TouchableOpacity style={styles.smallBtn} onPress={() => choosePhoto('camera', false)}>
                        <Text style={styles.smallBtnText}>+ Camera</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.smallBtn} onPress={() => choosePhoto('library', false)}>
                        <Text style={styles.smallBtnText}>+ Library</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {verification?.status !== 'approved' && (
                    <View style={styles.reviewNotice}>
                      <Text style={styles.reviewNoticeText}>
                        The image was accepted, but it may need human review before public posting.
                      </Text>
                    </View>
                  )}
                </>
              )}
            </View>
          )}

          {step === 2 && (
            <View>
              <Text style={styles.stepTitle}>Tell their story</Text>
              <Text style={styles.fieldLabel}>Name *</Text>
              <TextInput style={styles.input} value={name} onChangeText={setName} maxLength={200} placeholder="Person's name" placeholderTextColor={colors.ashDim} />
              <Text style={styles.fieldLabel}>Dates</Text>
              <TextInput style={styles.input} value={dates} onChangeText={setDates} maxLength={100} placeholder="Example: 1924–1998" placeholderTextColor={colors.ashDim} />
              <Text style={styles.fieldLabel}>Your remembrance *</Text>
              <TextInput
                style={[styles.input, styles.storyInput]}
                value={remembrance}
                onChangeText={setRemembrance}
                maxLength={REMEMBRANCE_MAX_LENGTH}
                multiline
                textAlignVertical="top"
                placeholder="Share the memories, character, and life you want others to remember."
                placeholderTextColor={colors.ashDim}
              />
              <Text style={styles.counter}>{remembrance.length}/{REMEMBRANCE_MAX_LENGTH}</Text>
            </View>
          )}

          {step === 3 && (
            <View>
              <Text style={styles.stepTitle}>Add a location—or skip it</Text>
              <Text style={styles.bodyText}>
                Location is optional. Without it, the story appears in Community Stories but never on the map.
              </Text>
              <TouchableOpacity style={[styles.locationBtn, busy && styles.disabled]} onPress={useCurrentLocation} disabled={busy}>
                <Pin size={16} color={colors.flame} />
                <Text style={styles.locationBtnText}>Use current location</Text>
              </TouchableOpacity>
              <View style={styles.searchRow}>
                <TextInput
                  style={[styles.input, styles.searchInput]}
                  value={cemeteryQuery}
                  onChangeText={handleCemeteryQueryChange}
                  placeholder="Search a cemetery or city"
                  returnKeyType="search"
                  onSubmitEditing={runCemeterySearch}
                  placeholderTextColor={colors.ashDim}
                />
                <TouchableOpacity style={[styles.searchBtn, busy && styles.disabled]} onPress={runCemeterySearch} disabled={busy}>
                  <Text style={styles.searchBtnText}>Search</Text>
                </TouchableOpacity>
              </View>
              {cemeteryResults.map(result => (
                <TouchableOpacity key={`${result.lat}-${result.lng}`} style={styles.resultRow} onPress={() => selectCemetery(result)}>
                  <Text style={styles.resultText}>{result.name}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={[styles.locationBtn, busy && styles.disabled]} onPress={choosePinLocation} disabled={busy}>
                <Pin size={16} color={colors.ash} />
                <Text style={styles.locationBtnText}>Drop a pin</Text>
              </TouchableOpacity>
              {locationMode === 'pin' && (
                <View>
                  <Text style={styles.mapHelp}>Tap the map to place the grave pin.</Text>
                  <MapView
                    style={styles.map}
                    initialRegion={gps ? {
                      latitude: gps.lat, longitude: gps.lng, latitudeDelta: 0.02, longitudeDelta: 0.02,
                    } : DEFAULT_PIN}
                    onPress={placePin}
                  >
                    {gps && <Marker coordinate={{ latitude: gps.lat, longitude: gps.lng }} />}
                  </MapView>
                </View>
              )}
              <TouchableOpacity style={styles.skipBtn} onPress={skipLocation}>
                <Text style={styles.skipBtnText}>Skip location</Text>
              </TouchableOpacity>
              <View style={styles.locationSummary}>
                <Text style={styles.locationSummaryText}>
                  {gps ? (locationLabel || 'Pin selected') : 'Location not provided'}
                </Text>
              </View>
            </View>
          )}

          {step === 4 && (
            <View>
              <Text style={styles.stepTitle}>Preview and choose visibility</Text>
              <View style={styles.previewCard}>
                <Image source={{ uri: photos[0]?.uri }} style={styles.previewImage} />
                <Text style={styles.previewName}>{name}</Text>
                {!!dates && <Text style={styles.previewDates}>{dates}</Text>}
                <Text style={styles.previewLocation}>{gps ? (locationLabel || 'Pin selected') : 'Location not provided'}</Text>
                <Text style={styles.previewStory} numberOfLines={8}>{remembrance}</Text>
              </View>
              <View style={styles.visibilityRow}>
                <TouchableOpacity style={[styles.visibilityBtn, visibility === 'public' && styles.visibilityBtnOn]} onPress={() => setVisibility('public')}>
                  <Text style={[styles.visibilityTitle, visibility === 'public' && styles.visibilityTitleOn]}>Public</Text>
                  <Text style={styles.visibilityText}>Eligible for Community Stories and, with GPS, the map.</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.visibilityBtn, visibility === 'private' && styles.visibilityBtnOn]} onPress={() => setVisibility('private')}>
                  <Text style={[styles.visibilityTitle, visibility === 'private' && styles.visibilityTitleOn]}>Private</Text>
                  <Text style={styles.visibilityText}>Saved only to your account.</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.reviewFootnote}>
                Public submissions may enter review. They remain private until approved.
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.footer}>
        {step > 0 && (
          <TouchableOpacity style={styles.footerBack} onPress={() => setStep(value => value - 1)} disabled={busy}>
            <Text style={styles.footerBackText}>Back</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.footerNext, busy && styles.disabled]} onPress={step === 4 ? submit : next} disabled={busy}>
          {busy ? (
            <View style={styles.busyRow}><ActivityIndicator size="small" color={colors.onFlame} /><Text style={styles.footerNextText}>{busyLabel}</Text></View>
          ) : (
            <Text style={styles.footerNextText}>{step === 4 ? 'Submit remembrance' : 'Continue'}</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.ink },
  center: { flex: 1, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.line },
  back: { width: 70, color: colors.ash, fontFamily: fonts.body, fontSize: 14 },
  headerTitle: { flex: 1, color: colors.parchment, textAlign: 'center', fontFamily: fonts.title, fontSize: 17 },
  headerSpacer: { width: 70 },
  progressRow: { flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  progressItem: { flex: 1, alignItems: 'center' },
  progressDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.line, marginBottom: 4 },
  progressDotOn: { backgroundColor: colors.flame },
  progressText: { color: colors.ashDim, fontSize: 8, fontFamily: fonts.body },
  progressTextOn: { color: colors.parchment },
  scroll: { padding: 20, paddingBottom: 40 },
  stepTitle: { color: colors.parchment, fontFamily: fonts.title, fontSize: 24, marginBottom: 12 },
  bodyText: { color: colors.ash, fontFamily: fonts.body, fontSize: 14, lineHeight: 22, marginBottom: 16 },
  linkBtn: { paddingVertical: 12 },
  linkText: { color: colors.flame, fontFamily: fonts.bodyMedium, textDecorationLine: 'underline' },
  checkRow: { flexDirection: 'row', gap: 12, alignItems: 'center', marginTop: 18, padding: 14, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, backgroundColor: colors.stone2 },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: colors.ashDim, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: colors.flame, borderColor: colors.flame },
  checkmark: { color: colors.onFlame, fontFamily: fonts.sansBold },
  checkLabel: { flex: 1, color: colors.parchment, fontFamily: fonts.body, lineHeight: 20 },
  signInCard: { margin: 24, padding: 20, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.stone2 },
  signInTitle: { color: colors.parchment, fontFamily: fonts.title, fontSize: 22, marginBottom: 10 },
  primaryBtn: { backgroundColor: colors.flame, borderRadius: radius.md, padding: 15, alignItems: 'center', marginTop: 8 },
  primaryBtnText: { color: colors.onFlame, fontFamily: fonts.sansBold, fontSize: 14 },
  secondaryBtn: { borderWidth: 1, borderColor: colors.flame, borderRadius: radius.md, padding: 14, alignItems: 'center', marginTop: 10 },
  secondaryBtnText: { color: colors.flame, fontFamily: fonts.bodyMedium },
  photoActions: { marginTop: 8 },
  photoStrip: { gap: 12, paddingVertical: 16 },
  photoWrap: { width: 154 },
  photo: { width: 154, height: 190, borderRadius: radius.sm, backgroundColor: colors.stone2 },
  photoLabel: { color: colors.ash, fontFamily: fonts.body, fontSize: 11, marginTop: 5 },
  removePhoto: { position: 'absolute', right: 6, top: 6, width: 28, height: 28, borderRadius: 14, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  removePhotoText: { color: colors.parchment, fontSize: 20 },
  inlineActions: { flexDirection: 'row', gap: 10 },
  smallBtn: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, padding: 12, alignItems: 'center' },
  smallBtnText: { color: colors.flame, fontFamily: fonts.bodyMedium },
  reviewNotice: { marginTop: 16, padding: 12, borderWidth: 1, borderColor: colors.ember, borderRadius: radius.sm, backgroundColor: colors.stone2 },
  reviewNoticeText: { color: colors.parchment, fontFamily: fonts.body, fontSize: 12, lineHeight: 18 },
  fieldLabel: { color: colors.ash, fontFamily: fonts.bodyMedium, marginTop: 12, marginBottom: 6 },
  input: { color: colors.parchment, fontFamily: fonts.body, fontSize: 15, backgroundColor: colors.stone2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 12 },
  storyInput: { minHeight: 190, lineHeight: 22 },
  counter: { color: colors.ashDim, fontFamily: fonts.body, fontSize: 11, textAlign: 'right', marginTop: 5 },
  locationBtn: { flexDirection: 'row', gap: 9, alignItems: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, padding: 14, marginBottom: 10, backgroundColor: colors.stone2 },
  locationBtnText: { color: colors.parchment, fontFamily: fonts.bodyMedium },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  searchInput: { flex: 1 },
  searchBtn: { backgroundColor: colors.flame, borderRadius: radius.sm, justifyContent: 'center', paddingHorizontal: 14 },
  searchBtnText: { color: colors.onFlame, fontFamily: fonts.sansBold },
  resultRow: { padding: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  resultText: { color: colors.parchment, fontFamily: fonts.body, fontSize: 12, lineHeight: 18 },
  mapHelp: { color: colors.ash, fontFamily: fonts.body, marginVertical: 8 },
  map: { height: 260, borderRadius: radius.sm, marginBottom: 12 },
  skipBtn: { alignItems: 'center', padding: 13 },
  skipBtnText: { color: colors.ash, fontFamily: fonts.body, textDecorationLine: 'underline' },
  locationSummary: { padding: 12, backgroundColor: colors.stone2, borderRadius: radius.sm, borderLeftWidth: 2, borderLeftColor: colors.flame },
  locationSummaryText: { color: colors.parchment, fontFamily: fonts.body },
  previewCard: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.stone2, paddingBottom: 16 },
  previewImage: { width: '100%', height: 220, backgroundColor: colors.stone },
  previewName: { color: colors.parchment, fontFamily: fonts.title, fontSize: 23, marginTop: 15, marginHorizontal: 16 },
  previewDates: { color: colors.flame, fontFamily: fonts.body, marginHorizontal: 16, marginTop: 3 },
  previewLocation: { color: colors.ashDim, fontFamily: fonts.bodyItalic, marginHorizontal: 16, marginTop: 5 },
  previewStory: { color: colors.parchment, fontFamily: fonts.serif, fontSize: 15, lineHeight: 23, marginHorizontal: 16, marginTop: 14 },
  visibilityRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  visibilityBtn: { flex: 1, minHeight: 118, padding: 13, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, backgroundColor: colors.stone2 },
  visibilityBtnOn: { borderColor: colors.flame },
  visibilityTitle: { color: colors.ash, fontFamily: fonts.title, fontSize: 17, marginBottom: 7 },
  visibilityTitleOn: { color: colors.flame },
  visibilityText: { color: colors.ashDim, fontFamily: fonts.body, fontSize: 11, lineHeight: 17 },
  reviewFootnote: { color: colors.ashDim, fontFamily: fonts.bodyItalic, fontSize: 12, lineHeight: 18, marginTop: 12, textAlign: 'center' },
  footer: { flexDirection: 'row', gap: 10, padding: 14, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.stone },
  footerBack: { width: 82, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  footerBackText: { color: colors.ash, fontFamily: fonts.bodyMedium },
  footerNext: { flex: 1, backgroundColor: colors.flame, borderRadius: radius.sm, padding: 14, alignItems: 'center', justifyContent: 'center' },
  footerNextText: { color: colors.onFlame, fontFamily: fonts.sansBold },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  disabled: { opacity: 0.55 },
});


