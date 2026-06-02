import React, { useState } from 'react';
import { RefreshControl } from 'react-native';
import { colors } from './theme';

// Encapsulates the pull-to-refresh boilerplate shared across all screens.
// Pass an async callback; the hook manages the refreshing state and
// returns a ready-to-use refreshControl prop for any ScrollView/FlatList.
export function useRefresh(callback) {
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await callback();
    } finally {
      setRefreshing(false);
    }
  }

  return {
    refreshing,
    onRefresh,
    refreshControl: (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={onRefresh}
        tintColor={colors.flame}
        colors={[colors.flame]}
      />
    ),
  };
}
