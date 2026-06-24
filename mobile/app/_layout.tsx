import { Stack } from 'expo-router';

export default function Layout() {
  return (
    <Stack
      screenOptions={{
        headerTitle: 'Geeksy',
        headerStyle: { backgroundColor: '#120f34' },
        headerTintColor: '#fff',
      }}
    />
  );
}
