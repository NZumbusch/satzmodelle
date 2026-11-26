package ch.zumbusch.satzmodelle;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Keeps the app (and its WebView audio) alive while practising with the screen off or another app in front:
 * a media-playback foreground service with a notification and lock-screen controls.
 */
@CapacitorPlugin(name = "BackgroundAudio")
public class BackgroundAudioPlugin extends Plugin {
    private static BackgroundAudioPlugin instance;
    private boolean askedNotifications = false;

    @Override
    public void load() {
        instance = this;
    }

    /** Called by PlaybackService when a notification / lock-screen / headset button is pressed. */
    static void dispatch(String action) {
        if (instance == null) return;
        JSObject o = new JSObject();
        o.put("action", action);
        instance.notifyListeners("action", o);
    }

    @PluginMethod
    public void update(PluginCall call) {
        String title = call.getString("title", "Satzmodelle");
        boolean playing = Boolean.TRUE.equals(call.getBoolean("playing", false));
        maybeAskNotificationPermission();
        Intent i = new Intent(getContext(), PlaybackService.class);
        i.setAction(PlaybackService.ACTION_UPDATE);
        i.putExtra("title", title);
        i.putExtra("playing", playing);
        try {
            ContextCompat.startForegroundService(getContext(), i);
            call.resolve();
        } catch (Exception e) {
            // e.g. ForegroundServiceStartNotAllowedException when started from the background
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), PlaybackService.class));
        call.resolve();
    }

    private void maybeAskNotificationPermission() {
        if (askedNotifications || Build.VERSION.SDK_INT < 33) return;
        askedNotifications = true;
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                && getActivity() != null) {
            ActivityCompat.requestPermissions(getActivity(), new String[] { Manifest.permission.POST_NOTIFICATIONS }, 7301);
        }
    }

    @Override
    protected void handleOnDestroy() {
        getContext().stopService(new Intent(getContext(), PlaybackService.class));
        if (instance == this) instance = null;
    }
}
