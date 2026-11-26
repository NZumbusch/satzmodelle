package ch.zumbusch.satzmodelle;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.support.v4.media.MediaMetadataCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.media.app.NotificationCompat.MediaStyle;

/** Foreground service that keeps playback running in the background and shows media controls. */
public class PlaybackService extends Service {
    static final String ACTION_UPDATE = "ch.zumbusch.satzmodelle.UPDATE";
    static final String ACTION_TOGGLE = "ch.zumbusch.satzmodelle.TOGGLE";
    static final String ACTION_STOP = "ch.zumbusch.satzmodelle.STOP";
    private static final String CHANNEL = "playback";
    private static final int NOTIFICATION_ID = 7302;

    private MediaSessionCompat session;
    private PowerManager.WakeLock wakeLock;
    private String title = "Satzmodelle";
    private boolean playing = false;

    @Override
    public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, getString(R.string.playback_channel), NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
        session = new MediaSessionCompat(this, "Satzmodelle");
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { BackgroundAudioPlugin.dispatch("play"); }
            @Override public void onPause() { BackgroundAudioPlugin.dispatch("pause"); }
            @Override public void onStop() { BackgroundAudioPlugin.dispatch("stop"); }
        });
        session.setActive(true);
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "satzmodelle:playback");
        wakeLock.setReferenceCounted(false);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_TOGGLE.equals(action)) {
            BackgroundAudioPlugin.dispatch("toggle");
        } else if (ACTION_STOP.equals(action)) {
            BackgroundAudioPlugin.dispatch("stop");
            stopSelf();
            return START_NOT_STICKY;
        } else if (ACTION_UPDATE.equals(action) && intent != null) {
            title = intent.getStringExtra("title");
            if (title == null) title = "Satzmodelle";
            playing = intent.getBooleanExtra("playing", false);
        }
        updateSession();
        Notification n = buildNotification();
        int type = Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0;
        ServiceCompat.startForeground(this, NOTIFICATION_ID, n, type);
        if (playing) wakeLock.acquire(60 * 60 * 1000L);
        else if (wakeLock.isHeld()) wakeLock.release();
        return START_NOT_STICKY;
    }

    private void updateSession() {
        session.setMetadata(new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, "Satzmodelle")
                .build());
        session.setPlaybackState(new PlaybackStateCompat.Builder()
                .setActions(PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE
                        | PlaybackStateCompat.ACTION_PLAY_PAUSE | PlaybackStateCompat.ACTION_STOP)
                .setState(playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                        PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, 1f)
                .build());
    }

    private PendingIntent service(String action, int code) {
        Intent i = new Intent(this, PlaybackService.class).setAction(action);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification buildNotification() {
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent content = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_note)
                .setContentTitle(title)
                .setContentText(getString(playing ? R.string.playback_playing : R.string.playback_paused))
                .setContentIntent(content)
                .setOngoing(playing)
                .setSilent(true)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .addAction(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                        getString(playing ? R.string.playback_pause : R.string.playback_play), service(ACTION_TOGGLE, 1))
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, getString(R.string.playback_stop), service(ACTION_STOP, 2))
                .setStyle(new MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1))
                .build();
    }

    @Override
    public void onDestroy() {
        if (wakeLock.isHeld()) wakeLock.release();
        session.setActive(false);
        session.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
