package com.ponoi.app;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * v1.444.0: включатель постоянной службы для музыки (см. MusicService).
 *
 * Зачем отдельным плагином: решение «музыка идёт / музыка встала» принимает
 * веб-часть — она одна знает про очередь, паузу и то, что трек кончился. Здесь
 * только исполнение, без своей головы.
 *
 * Разрешение на уведомления. С Android 13 показ уведомлений спрашивается у
 * человека, и без него служба на переднем плане не поднимется. Мы НЕ просим его
 * при запуске приложения: спрашивать «можно уведомления?» у того, кто ещё
 * ничего не включил, — верный способ получить отказ навсегда. Просим ровно в тот
 * момент, когда человек первый раз включил музыку и свернул приложение.
 */
@CapacitorPlugin(name = "MusicKeepAlive")
public class MusicKeepAlive extends Plugin {

    /** Разрешено ли показывать уведомления (до Android 13 — всегда, если не
     *  выключено в настройках самим человеком). */
    @PluginMethod
    public void canNotify(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("value", allowed());
        call.resolve(ret);
    }

    private boolean allowed() {
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                int st = getContext().checkSelfPermission("android.permission.POST_NOTIFICATIONS");
                if (st != PackageManager.PERMISSION_GRANTED) return false;
            }
            NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            return nm != null && nm.areNotificationsEnabled();
        } catch (Exception e) {
            return false;
        }
    }

    /** Спросить разрешение. Системное окно показывается один раз за установку:
     *  если человек отказал, второго окна не будет — и это его право. */
    @PluginMethod
    public void requestNotify(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= 33 && getActivity() != null) {
                getActivity().requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 7741);
            }
        } catch (Exception ignored) { }
        call.resolve();
    }

    /** Музыка пошла: держим процесс. Повторный вызов только обновляет надпись. */
    @PluginMethod
    public void start(PluginCall call) {
        if (!allowed()) {
            // Врать «включил», когда служба не поднимется, нельзя: веб-часть по
            // этому ответу решает, спрашивать ли разрешение.
            JSObject ret = new JSObject();
            ret.put("value", false);
            call.resolve(ret);
            return;
        }
        try {
            Intent i = new Intent(getContext(), MusicService.class);
            i.setAction(MusicService.ACTION_START);
            i.putExtra(MusicService.EXTRA_TITLE, call.getString("title"));
            i.putExtra(MusicService.EXTRA_ARTIST, call.getString("artist"));
            MusicService.ensureChannel(getContext());
            if (Build.VERSION.SDK_INT >= 26) getContext().startForegroundService(i);
            else getContext().startService(i);
            JSObject ret = new JSObject();
            ret.put("value", true);
            call.resolve(ret);
        } catch (Exception e) {
            // Не подняли службу — музыка продолжит играть как раньше, просто без
            // защиты от выгрузки. Это не повод показывать ошибку человеку.
            JSObject ret = new JSObject();
            ret.put("value", false);
            call.resolve(ret);
        }
    }

    /** Музыка встала: отпускаем процесс. Держать службу дольше нужного — это
     *  висящее уведомление и съеденная батарея. */
    @PluginMethod
    public void stop(PluginCall call) {
        try {
            Intent i = new Intent(getContext(), MusicService.class);
            i.setAction(MusicService.ACTION_STOP);
            getContext().stopService(i);
        } catch (Exception ignored) { }
        call.resolve();
    }
}
