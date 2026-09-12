package com.hammertrack.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.exifinterface.media.ExifInterface;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.UUID;

/**
 * The photo's OWN GPS coordinates (Brian, Sep 12: "No. I want the gps
 * coordinates of photos").
 *
 * A web file input cannot have them. Since Android 10 the system REDACTS the
 * GPS tags out of any image handed to an app, and the only way to get the
 * unredacted original is to ask MediaStore for it by name —
 * `MediaStore.setRequireOriginal(uri)` — while holding ACCESS_MEDIA_LOCATION.
 * A WebView's file chooser never does that, so `exifr` was reading a copy
 * whose location had already been stripped: the pixels are identical and the
 * coordinates are simply gone.
 *
 * So the gallery door moves into native code. This plugin picks from
 * MediaStore (ACTION_PICK returns real `content://media/external/...` URIs —
 * the Android 13 photo picker returns `content://media/picker/...`, which
 * setRequireOriginal rejects, which is why the modern picker is NOT used
 * here), asks for the original, copies those exact bytes into our own cache,
 * and reads the EXIF off that copy.
 *
 * Bytes come back to the page one photo at a time as base64. That is not the
 * prettiest transport, but the app loads from a REMOTE origin
 * (server.url = hammertrack.ai), so the usual `convertFileSrc` trick — fetch
 * a local file:// through Capacitor's own scheme — is a cross-origin request
 * to a host that will not answer. Base64 over the bridge always works, and
 * one photo at a time keeps the peak memory to one photo.
 *
 * Everything degrades: no permission, an OEM that does not honour the
 * original request, or a photo that genuinely has no GPS all return a row
 * with `hasGps: false`. The page then falls back to what it did before —
 * asking where the picture was taken. Nothing here ever invents coordinates.
 */
@CapacitorPlugin(
    name = "OriginalPhotos",
    permissions = {
        // Android 14+: asking for both lets the system offer "Select photos"
        // (partial access), which is the grant most people will give.
        @Permission(alias = "media34", strings = {
            Manifest.permission.READ_MEDIA_IMAGES,
            Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED,
            Manifest.permission.ACCESS_MEDIA_LOCATION
        }),
        // Android 13: no partial access yet.
        @Permission(alias = "media33", strings = {
            Manifest.permission.READ_MEDIA_IMAGES,
            Manifest.permission.ACCESS_MEDIA_LOCATION
        }),
        // Android 10–12: one storage read permission covered images.
        @Permission(alias = "mediaLegacy", strings = {
            Manifest.permission.READ_EXTERNAL_STORAGE,
            Manifest.permission.ACCESS_MEDIA_LOCATION
        })
    }
)
public class OriginalPhotosPlugin extends Plugin {

    /** Matches the sheet's own ceiling; also the memory ceiling for one pick. */
    private static final int MAX_PHOTOS = 12;

    private String aliasForThisAndroid() {
        if (Build.VERSION.SDK_INT >= 34) return "media34";
        if (Build.VERSION.SDK_INT >= 33) return "media33";
        return "mediaLegacy";
    }

    private File cacheDir() {
        File dir = new File(getContext().getCacheDir(), "ht-orig");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    /** Is the native door even usable here? The page asks before it offers it. */
    @PluginMethod
    public void available(PluginCall call) {
        JSObject out = new JSObject();
        // setRequireOriginal landed in Android 10. Below that nothing is
        // redacted in the first place and the web input is already fine.
        out.put("available", Build.VERSION.SDK_INT >= 29);
        out.put("granted", getPermissionState(aliasForThisAndroid()) == com.getcapacitor.PermissionState.GRANTED);
        call.resolve(out);
    }

    @PluginMethod
    public void pick(PluginCall call) {
        String alias = aliasForThisAndroid();
        if (getPermissionState(alias) != com.getcapacitor.PermissionState.GRANTED) {
            requestPermissionForAlias(alias, call, "afterPermission");
            return;
        }
        launchPicker(call);
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        if (getPermissionState(aliasForThisAndroid()) != com.getcapacitor.PermissionState.GRANTED) {
            // A refusal is an answer, not an error — the page falls back to
            // its own picker and asks where the photos were taken.
            JSObject out = new JSObject();
            out.put("denied", true);
            out.put("photos", new JSArray());
            call.resolve(out);
            return;
        }
        launchPicker(call);
    }

    private void launchPicker(PluginCall call) {
        // ACTION_PICK against the images collection, deliberately: it hands
        // back MediaStore ids, and only a MediaStore id can be re-requested
        // as an original.
        Intent intent = new Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI);
        intent.setType("image/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        startActivityForResult(call, intent, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject out = new JSObject();
        JSArray photos = new JSArray();
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            out.put("cancelled", true);
            out.put("photos", photos);
            call.resolve(out);
            return;
        }

        // Each pick starts clean, so a cancelled or half-used previous batch
        // does not sit in the cache forever.
        purge();

        Intent data = result.getData();
        int count = data.getClipData() != null ? data.getClipData().getItemCount() : (data.getData() != null ? 1 : 0);
        if (count > MAX_PHOTOS) count = MAX_PHOTOS;
        for (int i = 0; i < count; i++) {
            Uri uri = data.getClipData() != null ? data.getClipData().getItemAt(i).getUri() : data.getData();
            if (uri == null) continue;
            JSObject row = ingest(uri);
            if (row != null) photos.put(row);
        }
        out.put("photos", photos);
        call.resolve(out);
    }

    /**
     * Copy one picked image into our cache with its metadata intact, and read
     * the coordinates off that copy. A byte-for-byte copy of the ORIGINAL
     * keeps the EXIF; a copy of the redacted stream would not, which is the
     * whole point of the setRequireOriginal call below.
     */
    private JSObject ingest(Uri uri) {
        Uri source = uri;
        boolean original = false;
        if (Build.VERSION.SDK_INT >= 29) {
            try {
                source = MediaStore.setRequireOriginal(uri);
                original = true;
            } catch (Throwable t) {
                // Some OEM gallery providers hand back a URI MediaStore does
                // not own. Fall back to the redacted stream: the picture is
                // still usable, it just arrives without coordinates.
                source = uri;
            }
        }

        String name = displayName(uri);
        String mime = getContext().getContentResolver().getType(uri);
        if (mime == null) mime = "image/jpeg";
        String ext = mime.contains("png") ? "png" : mime.contains("webp") ? "webp" : "jpg";
        String id = UUID.randomUUID().toString();
        File dest = new File(cacheDir(), id + "." + ext);

        long size;
        try (InputStream in = getContext().getContentResolver().openInputStream(source);
             OutputStream os = new FileOutputStream(dest)) {
            if (in == null) return null;
            byte[] buf = new byte[64 * 1024];
            long total = 0;
            int n;
            while ((n = in.read(buf)) > 0) {
                os.write(buf, 0, n);
                total += n;
            }
            size = total;
        } catch (Throwable t) {
            dest.delete();
            return null;
        }

        double[] latLng = null;
        long takenAt = 0L;
        try {
            ExifInterface exif = new ExifInterface(dest.getAbsolutePath());
            float[] ll = new float[2];
            if (exif.getLatLong(ll) && !(ll[0] == 0f && ll[1] == 0f)) latLng = new double[] { ll[0], ll[1] };
            Long when = exif.getDateTimeOriginal();
            if (when == null) when = exif.getDateTime();
            if (when != null) takenAt = when;
        } catch (Throwable ignored) { /* no EXIF block at all */ }

        JSObject row = new JSObject();
        row.put("id", id);
        row.put("name", name != null ? name : (id + "." + ext));
        row.put("mimeType", mime);
        row.put("size", size);
        row.put("hasGps", latLng != null);
        if (latLng != null) {
            row.put("lat", latLng[0]);
            row.put("lng", latLng[1]);
        }
        if (takenAt > 0) row.put("takenAt", takenAt);
        // Diagnostic, shown to nobody but useful in a bug report: did the OS
        // actually let us ask for the original on this device?
        row.put("original", original);
        return row;
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContext().getContentResolver()
                .query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Throwable ignored) { }
        return null;
    }

    /** The bytes for ONE photo, so a batch never sits in memory all at once. */
    @PluginMethod
    public void read(PluginCall call) {
        String id = call.getString("id");
        if (id == null || id.contains("/") || id.contains("..")) {
            call.reject("bad id");
            return;
        }
        File[] files = cacheDir().listFiles();
        File found = null;
        if (files != null) {
            for (File f : files) if (f.getName().startsWith(id + ".")) { found = f; break; }
        }
        if (found == null) {
            call.reject("that photo is no longer in the cache");
            return;
        }
        try (InputStream in = new java.io.FileInputStream(found);
             java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream()) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            JSObject out = new JSObject();
            out.put("data", Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP));
            call.resolve(out);
        } catch (Throwable t) {
            call.reject("could not read that photo");
        }
    }

    /** Called once the page has uploaded what it wanted. */
    @PluginMethod
    public void clear(PluginCall call) {
        purge();
        call.resolve();
    }

    private void purge() {
        File[] files = cacheDir().listFiles();
        if (files != null) for (File f : files) f.delete();
    }
}
