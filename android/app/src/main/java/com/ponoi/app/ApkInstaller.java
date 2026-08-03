package com.ponoi.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
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

/**
 * v1.308.0: обновление приложения на телефоне без выхода в браузер.
 *
 * Раньше кнопка «Скачать» просто открывала ссылку на .apk — человек уходил в
 * браузер, искал файл в загрузках и ставил вручную. Теперь файл скачивается
 * внутри приложения с показом прогресса, и сразу открывается системный
 * установщик.
 *
 * Чего обойти НЕЛЬЗЯ и не нужно: Android всё равно спросит подтверждение на
 * установку поверх старой версии, и потребует разовое разрешение «установка из
 * этого источника». Это защита самой системы — приложение, умеющее молча
 * подменять себя, было бы дырой куда опаснее любой из тех, что мы закрывали.
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstaller extends Plugin {

    /** Разрешено ли этому приложению ставить пакеты. До Android 8 разрешение общесистемное. */
    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject ret = new JSObject();
        boolean ok = Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || getContext().getPackageManager().canRequestPackageInstalls();
        ret.put("value", ok);
        call.resolve(ret);
    }

    /** Открыть системный экран, где это разрешение выдаётся. Браузер при этом не нужен. */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        }
        call.resolve();
    }

    /**
     * v1.443.0: тип сети — чтобы обновление не качалось само на мобильном
     * трафике. Приложение весит десятки мегабайт, и «оно само скачало» на
     * тарифе с лимитом — это не забота, а неприятность.
     */
    @PluginMethod
    public void netInfo(PluginCall call) {
        JSObject ret = new JSObject();
        boolean metered = true, online = false;
        try {
            ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                Network n = cm.getActiveNetwork();
                NetworkCapabilities caps = n == null ? null : cm.getNetworkCapabilities(n);
                if (caps != null) {
                    online = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
                    metered = !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED);
                }
            }
        } catch (Exception ignored) { }
        ret.put("metered", metered);
        ret.put("online", online);
        call.resolve(ret);
    }

    /** Файл уже скачанного обновления. */
    private File updateFile() {
        return new File(getContext().getCacheDir(), "ponoi-update.apk");
    }

    /** Отметка о том, для какой версии лежит скачанный файл. */
    private File updateMark() {
        return new File(getContext().getCacheDir(), "ponoi-update.version");
    }

    /**
     * v1.443.0: какая версия уже скачана и готова к установке.
     *
     * Проверяется не только отметка, но и сам файл: кэш система вправе очистить
     * в любой момент, и без этой сверки приложение показывало бы кнопку
     * «Установить», за которой ничего нет.
     */
    @PluginMethod
    public void readyVersion(PluginCall call) {
        JSObject ret = new JSObject();
        String v = null;
        try {
            File f = updateFile(), m = updateMark();
            if (f.exists() && f.length() > 0 && m.exists()) {
                byte[] buf = new byte[64];
                try (java.io.FileInputStream in = new java.io.FileInputStream(m)) {
                    int n = in.read(buf);
                    if (n > 0) v = new String(buf, 0, n, "UTF-8").trim();
                }
            }
        } catch (Exception ignored) { }
        ret.put("value", v == null || v.isEmpty() ? null : v);
        call.resolve(ret);
    }

    /** v1.443.0: скачать заранее, установщик не открывать. */
    @PluginMethod
    public void download(final PluginCall call) {
        fetchApk(call, call.getString("url"), call.getString("version"), false);
    }

    /**
     * v1.443.0: открыть установщик для уже скачанного файла.
     *
     * Разделение на «скачать» и «поставить» — весь смысл фонового обновления:
     * файл приезжает по Wi-Fi заранее и молча, а система спрашивает согласие
     * только тогда, когда человек сам нажал «Установить».
     */
    @PluginMethod
    public void install(PluginCall call) {
        try {
            File out = updateFile();
            if (!out.exists() || out.length() == 0) {
                call.reject("Обновление ещё не скачано");
                return;
            }
            launchInstaller(out);
            call.resolve();
        } catch (Exception e) {
            call.reject("Не удалось открыть установщик: " + e.getMessage());
        }
    }

    private void launchInstaller(File out) {
        Uri uri = FileProvider.getUriForFile(
                getContext(), getContext().getPackageName() + ".fileprovider", out);
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "application/vnd.android.package-archive");
        // Без этого флага установщик не получит доступа к файлу в нашем кэше.
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        Activity act = getActivity();
        if (act != null) act.startActivity(i); else getContext().startActivity(i);
    }

    @PluginMethod
    public void downloadAndInstall(final PluginCall call) {
        fetchApk(call, call.getString("url"), call.getString("version"), true);
    }

    private void fetchApk(final PluginCall call, final String url, final String version, final boolean thenInstall) {
        if (url == null || url.isEmpty()) {
            call.reject("Не указан адрес файла обновления");
            return;
        }
        // Качаем в отдельном потоке: файл на десятки мегабайт, и главный поток
        // на это время просто перестал бы отвечать.
        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection conn = null;
                try {
                    File out = updateFile();
                    // Отметку сносим ДО скачивания: если оно оборвётся, файл
                    // останется недокачанным, и «готово к установке» на него
                    // указывать не должно.
                    updateMark().delete();
                    if (out.exists() && !out.delete()) {
                        call.reject("Не удалось освободить место под обновление");
                        return;
                    }
                    conn = (HttpURLConnection) new URL(url).openConnection();
                    conn.setInstanceFollowRedirects(true);
                    conn.setConnectTimeout(20000);
                    conn.setReadTimeout(60000);
                    conn.connect();
                    if (conn.getResponseCode() / 100 != 2) {
                        call.reject("Сервер обновлений ответил " + conn.getResponseCode());
                        return;
                    }
                    long total = conn.getContentLength();
                    // try-with-resources: при обрыве сети посреди скачивания потоки
                    // закроются сами. Без него открытый файл и сокет висели бы до
                    // сборки мусора, а повторная попытка упиралась бы в занятый файл.
                    try (InputStream in = conn.getInputStream();
                         FileOutputStream fos = new FileOutputStream(out)) {
                        byte[] buf = new byte[64 * 1024];
                        long done = 0;
                        int lastPct = -1;
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            fos.write(buf, 0, n);
                            done += n;
                            if (total > 0) {
                                int pct = (int) (done * 100 / total);
                                // Событие шлём только при смене процента: иначе на быстрой
                                // сети мост между Java и интерфейсом захлебнулся бы.
                                if (pct != lastPct) {
                                    lastPct = pct;
                                    JSObject ev = new JSObject();
                                    ev.put("percent", pct);
                                    notifyListeners("progress", ev);
                                }
                            }
                        }
                        fos.flush();
                    }

                    if (version != null && !version.isEmpty()) {
                        try (FileOutputStream mf = new FileOutputStream(updateMark())) {
                            mf.write(version.getBytes("UTF-8"));
                        }
                    }
                    if (thenInstall) launchInstaller(out);
                    JSObject ret = new JSObject();
                    ret.put("bytes", out.length());
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject("Не удалось скачать обновление: " + e.getMessage());
                } finally {
                    if (conn != null) conn.disconnect();
                }
            }
        }).start();
    }
}
