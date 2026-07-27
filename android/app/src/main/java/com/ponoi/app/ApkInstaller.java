package com.ponoi.app;

import android.app.Activity;
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

    @PluginMethod
    public void downloadAndInstall(final PluginCall call) {
        final String url = call.getString("url");
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
                    File out = new File(getContext().getCacheDir(), "ponoi-update.apk");
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

                    Uri uri = FileProvider.getUriForFile(
                            getContext(), getContext().getPackageName() + ".fileprovider", out);
                    Intent i = new Intent(Intent.ACTION_VIEW);
                    i.setDataAndType(uri, "application/vnd.android.package-archive");
                    // Без этого флага установщик не получит доступа к файлу в нашем кэше.
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    Activity act = getActivity();
                    if (act != null) act.startActivity(i); else getContext().startActivity(i);
                    call.resolve();
                } catch (Exception e) {
                    call.reject("Не удалось скачать обновление: " + e.getMessage());
                } finally {
                    if (conn != null) conn.disconnect();
                }
            }
        }).start();
    }
}
