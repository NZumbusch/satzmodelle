package ch.zumbusch.satzmodelle;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * Self-update: download the published APK (https only), verify its SHA-256 while streaming, then hand it
 * to Android's package installer. Android itself refuses the install unless the APK is signed with the
 * same key as the installed app and has a higher versionCode.
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private static final String FILE = "update.apk";

    private File apkFile() {
        File dir = new File(getContext().getCacheDir(), "updates");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return new File(dir, FILE);
    }

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url", "");
        String expected = call.getString("sha256", "").toLowerCase();
        if (!url.startsWith("https://")) { call.reject("only https downloads are allowed", "bad_url"); return; }
        if (!expected.matches("[0-9a-f]{64}")) { call.reject("invalid sha256", "bad_hash"); return; }
        new Thread(() -> {
            File out = apkFile();
            HttpURLConnection con = null;
            try {
                con = (HttpURLConnection) new URL(url).openConnection();
                con.setConnectTimeout(20000);
                con.setReadTimeout(30000);
                con.setUseCaches(false);
                int code = con.getResponseCode();
                if (code != 200) throw new Exception("HTTP " + code);
                long total = con.getContentLengthLong();
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                long done = 0, lastEvent = 0;
                try (InputStream in = con.getInputStream(); FileOutputStream fo = new FileOutputStream(out)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        fo.write(buf, 0, n);
                        md.update(buf, 0, n);
                        done += n;
                        long now = System.currentTimeMillis();
                        if (now - lastEvent > 150) {
                            lastEvent = now;
                            JSObject p = new JSObject();
                            p.put("bytes", done);
                            p.put("total", total);
                            p.put("fraction", total > 0 ? (double) done / total : 0);
                            notifyListeners("progress", p);
                        }
                    }
                }
                StringBuilder hex = new StringBuilder();
                for (byte b : md.digest()) hex.append(String.format("%02x", b));
                if (!hex.toString().equals(expected)) {
                    //noinspection ResultOfMethodCallIgnored
                    out.delete();
                    call.reject("checksum mismatch", "checksum");
                    return;
                }
                JSObject r = new JSObject();
                r.put("bytes", done);
                call.resolve(r);
            } catch (Exception e) {
                //noinspection ResultOfMethodCallIgnored
                out.delete();
                call.reject(e.getMessage() == null ? "download failed" : e.getMessage(), "download");
            } finally {
                if (con != null) con.disconnect();
            }
        }).start();
    }

    @PluginMethod
    public void install(PluginCall call) {
        File f = apkFile();
        if (!f.exists()) { call.reject("nothing downloaded", "missing"); return; }
        JSObject r = new JSObject();
        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(s);
            r.put("status", "needs-permission");
            call.resolve(r);
            return;
        }
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        r.put("status", "started");
        call.resolve(r);
    }

    /** The installed versionCode (Capacitor's App.getInfo gives it as a string; this avoids parsing). */
    @PluginMethod
    public void installed(PluginCall call) {
        JSObject r = new JSObject();
        try {
            android.content.pm.PackageInfo pi = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            r.put("versionCode", Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode);
            r.put("versionName", pi.versionName);
        } catch (Exception e) {
            r.put("versionCode", 0);
        }
        call.resolve(r);
    }
}
