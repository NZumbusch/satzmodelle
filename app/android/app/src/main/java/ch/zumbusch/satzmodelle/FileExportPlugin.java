package ch.zumbusch.satzmodelle;

import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Save a large file (a backup) to a place the user picks (Downloads, an SD card, a cloud provider ...)
 * via the Storage Access Framework. The WebView sends the bytes in base64 chunks.
 */
@CapacitorPlugin(name = "FileExport")
public class FileExportPlugin extends Plugin {
    private ActivityResultLauncher<String> launcher;
    private PluginCall pending;
    private final Map<String, OutputStream> open = new HashMap<>();

    @Override
    public void load() {
        launcher = getActivity().registerForActivityResult(new ActivityResultContracts.CreateDocument("application/zip"), this::onPicked);
    }

    private void onPicked(Uri uri) {
        PluginCall call = pending;
        pending = null;
        if (call == null) return;
        if (uri == null) { call.reject("cancelled", "cancelled"); return; }
        try {
            OutputStream os = getContext().getContentResolver().openOutputStream(uri, "w");
            if (os == null) { call.reject("cannot open", "error"); return; }
            String handle = UUID.randomUUID().toString();
            open.put(handle, os);
            JSObject o = new JSObject();
            o.put("handle", handle);
            call.resolve(o);
        } catch (Exception e) {
            call.reject(e.getMessage(), "error");
        }
    }

    @PluginMethod
    public void create(PluginCall call) {
        pending = call;
        launcher.launch(call.getString("name", "satzmodelle.zip"));
    }

    @PluginMethod
    public void write(PluginCall call) {
        OutputStream os = open.get(call.getString("handle"));
        if (os == null) { call.reject("unknown handle", "error"); return; }
        try {
            os.write(Base64.decode(call.getString("data", ""), Base64.NO_WRAP));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage(), "error");
        }
    }

    @PluginMethod
    public void close(PluginCall call) {
        OutputStream os = open.remove(call.getString("handle"));
        try {
            if (os != null) os.close();
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage(), "error");
        }
    }
}
