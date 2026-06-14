import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Purchases from 'react-native-purchases';
import { colors, fonts, radius } from '../lib/theme';
import { SCAN_LIMIT_GUEST, SCAN_LIMIT_USER } from '../lib/scan-limit';
import { logEvent, EVENTS } from '../lib/analytics';

// Product IDs must match exactly what's created in Google Play Console + RevenueCat
const PRODUCT_IDS = ['gravestory_5_scans', 'gravestory_20_scans', 'gravestory_60_scans', 'gravestory_150_scans'];

// The live price the user pays/sees comes from RevenueCat (pkg.product.priceString),
// which mirrors Google Play Console — so a price change is a STORE-side action, no OTA.
// The `price` strings below are only a fallback shown in the greyed-out offline preview
// when offerings fail to load; keep them in sync with the Play Console prices so the
// error state isn't misleading.
const PACK_INFO = {
  gravestory_5_scans:   { label: 'Starter',   scans: 5,   price: '$1.99' },
  gravestory_20_scans:  { label: 'Explorer',  scans: 20,  price: '$5.99' },
  gravestory_60_scans:  { label: 'Historian', scans: 60,  price: '$12.99' },
  gravestory_150_scans: { label: 'Legacy',    scans: 150, price: '$24.99' },
};

export default function PaywallScreen({ navigation, route }) {
  // The paywall is now only reached for the scan limit — saved-story limits were removed.
  const { count = 0, isGuest = false } = route.params ?? {};

  const isScan = true;
  const limit  = isGuest ? SCAN_LIMIT_GUEST : SCAN_LIMIT_USER;

  const [packages, setPackages]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [loadError, setLoadError]   = useState(null);
  const [purchasing, setPurchasing] = useState(null);

  async function loadOfferings() {
    setLoading(true);
    setLoadError(null);
    try {
      const offerings = await Purchases.getOfferings();
      const pkgs = offerings.current?.availablePackages ?? [];
      if (pkgs.length > 0) {
        setPackages(pkgs);
      } else {
        setPackages([]);
        // Offerings fetched OK but empty — RevenueCat dashboard offering is
        // missing, has no packages, or the products aren't approved in Play Console.
        setLoadError('Scan packs are not available right now. Please try again shortly.');
      }
    } catch (e) {
      console.warn('RC getOfferings failed:', e.message);
      setPackages([]);
      setLoadError('Could not load scan packs. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOfferings();
    // Funnel: the paywall was reached (scan limit hit → upgrade prompt shown).
    // Pair with purchase_completed to get view→buy conversion.
    logEvent(EVENTS.PAYWALL_SHOWN, { count, isGuest });
  }, []);

  async function handlePurchase(pkg) {
    setPurchasing(pkg.product.identifier);
    try {
      await Purchases.purchasePackage(pkg);
      // Funnel: a purchase completed in the SDK. The credits land via the
      // RevenueCat→Worker webhook→scan_credits — cross-check this count against
      // scan_credits.updated_at bumps to confirm the fragile webhook link fires.
      logEvent(EVENTS.PURCHASE_COMPLETED, { productId: pkg.product.identifier });
      Alert.alert('Purchase complete', 'Your scans have been added to your account.');
      navigation.goBack();
    } catch (e) {
      if (!e.userCancelled) {
        logEvent(EVENTS.PURCHASE_FAILED, { productId: pkg.product.identifier, reason: e.message });
        Alert.alert('Purchase failed', e.message ?? 'Please try again.');
      }
    } finally {
      setPurchasing(null);
    }
  }

  async function handleRestore() {
    try {
      await Purchases.restorePurchases();
      Alert.alert('Restored', 'Any previous purchases have been restored.');
    } catch (e) {
      Alert.alert('Restore failed', e.message ?? 'Please try again.');
    }
  }

  const title = isGuest ? 'Scan Limit Reached' : 'Free Scans Used Up';

  const countLabel = `${count} of ${limit} free scans used`;

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
            <Text style={styles.body}>
              {`Guest accounts get ${SCAN_LIMIT_GUEST} free scans. Sign in for free to get ${SCAN_LIMIT_USER} scans.`}
            </Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => navigation.navigate('Auth')}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>Sign In — It's Free</Text>
            </TouchableOpacity>
          </>
        ) : isScan ? (
          <>
            <Text style={styles.body}>
              Get more scans to keep discovering stories. Credits never expire.
            </Text>

            {loading ? (
              <ActivityIndicator color={colors.flame} style={{ marginVertical: 24 }} />
            ) : packages.length > 0 ? (
              packages.map(pkg => {
                const info = PACK_INFO[pkg.product.identifier] ?? {};
                const isBuying = purchasing === pkg.product.identifier;
                return (
                  <TouchableOpacity
                    key={pkg.product.identifier}
                    style={[styles.packBtn, isBuying && styles.packBtnDisabled]}
                    onPress={() => handlePurchase(pkg)}
                    activeOpacity={0.85}
                    disabled={!!purchasing}
                  >
                    {isBuying ? (
                      <ActivityIndicator color={colors.onFlame} />
                    ) : (
                      <>
                        <View>
                          <Text style={styles.packLabel}>{info.label ?? pkg.product.title}</Text>
                          <Text style={styles.packScans}>{info.scans ?? '?'} scans</Text>
                        </View>
                        <Text style={styles.packPrice}>
                          {pkg.product.priceString ?? info.price}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                );
              })
            ) : (
              <>
                {/* Preview of the packs — greyed out because they couldn't load */}
                {PRODUCT_IDS.map(id => {
                  const info = PACK_INFO[id];
                  return (
                    <View key={id} style={[styles.packBtn, styles.packBtnDisabled]}>
                      <View>
                        <Text style={styles.packLabel}>{info.label}</Text>
                        <Text style={styles.packScans}>{info.scans} scans</Text>
                      </View>
                      <Text style={styles.packPrice}>{info.price}</Text>
                    </View>
                  );
                })}
                {loadError && <Text style={styles.errorText}>{loadError}</Text>}
                <TouchableOpacity onPress={loadOfferings} style={styles.retryBtn} activeOpacity={0.7}>
                  <Text style={styles.retryText}>Tap to retry</Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity onPress={handleRestore} style={styles.restoreBtn}>
              <Text style={styles.restoreText}>Restore purchases</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.body}>
            Delete old stories to free up space.
          </Text>
        )}

        <Text style={styles.hint}>
          Scan packs never expire — use them at your own pace.
        </Text>

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
    marginBottom: 20,
  },

  packBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: radius.md,
    backgroundColor: colors.flame,
    marginBottom: 10,
    minHeight: 56,
  },
  packBtnDisabled: {
    opacity: 0.5,
  },
  packLabel: {
    color: colors.onFlame,
    fontSize: 15,
    fontFamily: fonts.sansBold,
  },
  packScans: {
    color: colors.onFlame,
    fontSize: 12,
    fontFamily: fonts.body,
    opacity: 0.8,
  },
  packPrice: {
    color: colors.onFlame,
    fontSize: 16,
    fontFamily: fonts.sansBold,
  },

  errorText: {
    color: colors.ember,
    fontSize: 13,
    fontFamily: fonts.body,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: 4,
    marginBottom: 8,
  },
  retryBtn: { marginTop: 4, marginBottom: 8, paddingVertical: 8 },
  retryText: {
    color: colors.flame,
    fontSize: 14,
    fontFamily: fonts.bodyMedium,
    textDecorationLine: 'underline',
    textAlign: 'center',
  },

  restoreBtn: { marginTop: 4, marginBottom: 16 },
  restoreText: {
    color: colors.ashDim,
    fontSize: 13,
    fontFamily: fonts.body,
    textDecorationLine: 'underline',
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
