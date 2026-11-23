package android.net.wifi;

import android.os.Handler;

/**
 * Stub SÓ PARA COMPILAÇÃO (o android.jar disponível é API 23; LocalOnlyHotspot é API 26).
 * Não entra no APK: em tempo de execução o Fire OS (API 28) fornece a classe real.
 */
public class WifiManager {
    private WifiManager() {}

    public WifiInfo getConnectionInfo() { throw new RuntimeException("stub"); }

    public void startLocalOnlyHotspot(LocalOnlyHotspotCallback callback, Handler handler) {
        throw new RuntimeException("stub");
    }

    public class LocalOnlyHotspotReservation implements AutoCloseable {
        public WifiConfiguration getWifiConfiguration() { throw new RuntimeException("stub"); }
        @Override public void close() { throw new RuntimeException("stub"); }
    }

    public static class LocalOnlyHotspotCallback {
        public static final int ERROR_NO_CHANNEL = 1;
        public static final int ERROR_GENERIC = 2;
        public static final int ERROR_INCOMPATIBLE_MODE = 3;
        public static final int ERROR_TETHERING_DISALLOWED = 4;
        public LocalOnlyHotspotCallback() {}
        public void onStarted(LocalOnlyHotspotReservation reservation) {}
        public void onStopped() {}
        public void onFailed(int reason) {}
    }
}
