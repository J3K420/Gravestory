import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radius } from '../lib/theme';
import { FREE_LIMIT_GUEST, FREE_LIMIT_USER } from '../lib/save-limit';
import { SCAN_LIMIT_GUEST, SCAN_LIMIT_USER } from '../lib/scan-limit';

export default function PaywallScreen({ navigation, route }) {
  const { count = 0, isGuest = false, type = 'save' } = route.params ?? {};

  const isScan = type === 'scan';
  const limit  = isScan
    ? (isGuest ? SCAN_LIMIT_GUEST : SCAN_LIMIT_USER)
    : (isGuest ? FREE_LIMIT_GUEST : FREE_LIMIT_USER);

  const title = isScan
    ? (isGuest ? 'Scan Limit Reached' : 'Free Scans Used Up')
    : (isGuest ? 'Story Limit Reached' : 'Collection Full');

  const guestBody = isScan
    ? `Guest accounts get ${SCAN_LIMIT_GUEST} free scans. Sign in for free to get ${SCAN_LIMIT_USER} scans.`
    : `Guest accounts can save ${FREE_LIMIT_GUEST} stories. Sign in for free to save up to ${FREE_LIMIT_USER}.`;

  const userBody = isScan
    ? `You've used your ${SCAN_LIMIT_USER} free scans. Buy a scan pack to keep exploring.`
    : `You've filled your free collection of ${FREE_LIMIT_USER} stories. Delete old stories to make room.`;

  const hint = isScan
    ? 'Scan packs never expire — use them at your own pace.'
    : 'You can delete old stories to free up space.';

  const countLabel = isScan
    ? `${count} of ${limit} free scans used`
    : `${count} of ${limit} stories saved`;

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.content}>
        <Text style={styles.icon}>🪦</Text>

        <Text style={styles.title}>{title}</Text>

        <Text style={styles.count}>{countLabel}</Text>

        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${Math.min((count / limit) * 100, 100)}%` }]} />
        </View>

        {isGuest ? (
          <>
            <Text style={styles.body}>{guestBody}</Text>

            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => navigation.navigate('Auth')}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>Sign In — It's Free</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.body}>{userBody}</Text>
        )}

        <Text style={styles.hint}>{hint}</Text>

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Text style={styles.secondaryBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ink },
  back: { padding: 24, paddingBottom: 0 },
  backText: { color: colors.ashDim, fontSize: 15, fontFamily: fonts.body },

  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 48,
  },

  icon: { fontSize: 52, marginBottom: 20 },

  title: {
    color: colors.parchment,
    fontSize: 26,
    fontFamily: fonts.title,
    letterSpacing: 0.5,
    textAlign: 'center',
    marginBottom: 12,
  },

  count: {
    color: colors.flame,
    fontSize: 15,
    fontFamily: fonts.bodyMedium,
    marginBottom: 10,
  },

  barTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.line,
    overflow: 'hidden',
    marginBottom: 28,
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: colors.flame,
  },

  body: {
    color: colors.ash,
    fontSize: 15,
    fontFamily: fonts.body,
    textAlign: 'center',
    lineHeight: 23,
    marginBottom: 28,
  },

  hint: {
    color: colors.ashDim,
    fontSize: 13,
    fontFamily: fonts.bodyItalic,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 32,
  },

  primaryBtn: {
    width: '100%',
    paddingVertical: 15,
    borderRadius: radius.md,
    alignItems: 'center',
    backgroundColor: colors.flame,
    marginBottom: 14,
  },
  primaryBtnText: {
    color: colors.onFlame,
    fontSize: 15,
    fontFamily: fonts.sansBold,
    letterSpacing: 0.5,
  },

  secondaryBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: radius.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.stone2,
  },
  secondaryBtnText: {
    color: colors.ash,
    fontSize: 14,
    fontFamily: fonts.body,
    letterSpacing: 0.5,
  },
});
