package ch.zumbusch.satzmodelle;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import java.security.MessageDigest;
import com.google.android.gms.common.api.CommonStatusCodes;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationClient;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.ClearTokenRequest;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;
import java.util.Collections;

/**
 * Google authorization for the Drive "appDataFolder" only (hidden app folder: the app can see nothing
 * else in the user's Drive). Returns a short-lived access token for the Drive REST API.
 * Needs an OAuth client of type Android (package + signing SHA-1) in Google Cloud; see docs/google-drive.md.
 */
@CapacitorPlugin(name = "DriveAuth")
public class DriveAuthPlugin extends Plugin {
    static final String SCOPE = "https://www.googleapis.com/auth/drive.appdata";
    private ActivityResultLauncher<IntentSenderRequest> launcher;
    private PluginCall pending;

    @Override
    public void load() {
        launcher = getActivity().registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), r -> {
            PluginCall call = pending;
            pending = null;
            if (call == null) return;
            if (r.getData() == null) {
                call.reject("cancelled (result " + r.getResultCode() + ")", "cancelled");
                return;
            }
            // Even when Google reports RESULT_CANCELED the intent usually carries the real status
            // (e.g. 10 = DEVELOPER_ERROR: no OAuth client for this package + signature).
            try {
                AuthorizationResult res = client().getAuthorizationResultFromIntent(r.getData());
                if (r.getResultCode() != Activity.RESULT_OK && res.getAccessToken() == null) {
                    call.reject("cancelled (result " + r.getResultCode() + ")", "cancelled");
                    return;
                }
                resolve(call, res);
            } catch (ApiException e) {
                rejectApi(call, e);
            }
        });
    }

    private AuthorizationClient client() {
        return Identity.getAuthorizationClient(getActivity());
    }

    private void resolve(PluginCall call, AuthorizationResult res) {
        if (res.getAccessToken() == null) {
            call.reject("no token", "error");
            return;
        }
        JSObject o = new JSObject();
        o.put("accessToken", res.getAccessToken());
        if (res.toGoogleSignInAccount() != null) o.put("email", res.toGoogleSignInAccount().getEmail());
        call.resolve(o);
    }

    @PluginMethod
    public void authorize(PluginCall call) {
        boolean interactive = Boolean.TRUE.equals(call.getBoolean("interactive", true));
        AuthorizationRequest req = AuthorizationRequest.builder()
                .setRequestedScopes(Collections.singletonList(new Scope(SCOPE)))
                .build();
        client().authorize(req)
                .addOnSuccessListener(res -> {
                    if (res.hasResolution()) {
                        if (!interactive) {
                            call.reject("consent needed", "needs_consent");
                            return;
                        }
                        PendingIntent pi = res.getPendingIntent();
                        if (pi == null) { call.reject("no intent", "error"); return; }
                        pending = call;
                        launcher.launch(new IntentSenderRequest.Builder(pi.getIntentSender()).build());
                    } else {
                        resolve(call, res);
                    }
                })
                .addOnFailureListener(e -> {
                    if (e instanceof ApiException) rejectApi(call, (ApiException) e);
                    else call.reject(e.getMessage(), "error");
                });
    }

    private void rejectApi(PluginCall call, ApiException e) {
        int code = e.getStatusCode();
        call.reject(CommonStatusCodes.getStatusCodeString(code) + " (" + code + "): " + e.getMessage(), "status_" + code);
    }

    /** Package name and signing-certificate SHA-1, exactly as Google Cloud expects them for the Android client. */
    @PluginMethod
    public void info(PluginCall call) {
        JSObject o = new JSObject();
        o.put("packageName", getContext().getPackageName());
        try {
            PackageManager pm = getContext().getPackageManager();
            Signature[] sigs;
            if (Build.VERSION.SDK_INT >= 28) {
                PackageInfo pi = pm.getPackageInfo(getContext().getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
                sigs = pi.signingInfo.getApkContentsSigners();
            } else {
                PackageInfo pi = pm.getPackageInfo(getContext().getPackageName(), PackageManager.GET_SIGNATURES);
                sigs = pi.signatures;
            }
            byte[] d = MessageDigest.getInstance("SHA-1").digest(sigs[0].toByteArray());
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < d.length; i++) {
                if (i > 0) sb.append(':');
                sb.append(String.format("%02X", d[i]));
            }
            o.put("sha1", sb.toString());
        } catch (Exception e) {
            o.put("sha1", "?");
        }
        call.resolve(o);
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        String token = call.getString("accessToken");
        if (token == null) { call.resolve(); return; }
        client().clearToken(ClearTokenRequest.builder().setToken(token).build())
                .addOnSuccessListener(v -> call.resolve())
                .addOnFailureListener(e -> call.resolve());
    }
}
